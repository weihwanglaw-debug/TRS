/**
 * registrationsApi.ts — Registration, Payment & Refund management.
 *
 * ── AUTH SPLIT ────────────────────────────────────────────────────────────────
 *
 *   PUBLIC  (no login required — matches HTML checkout page):
 *     apiCreateRegistration()    POST /api/registrations
 *     apiInitiateCheckout()      POST /api/Payment/create-checkout-session
 *     apiGetRegistration()       GET  /api/registrations/:id   (receipt lookup)
 *
 *   ADMIN   (requires Bearer token):
 *     apiGetRegistrations()      GET  /api/registrations        (admin list)
 *     apiUpdateRegistrationStatus()
 *     apiUpdateGroupStatus()
 *     apiUpdateGroupSeed()
 *     apiGetPayment()
 *     apiUpdatePayment()
 *     apiGetRefunds()
 *     apiInitiateRefund()
 *     apiExportRegistrations()
 *     apiGetRegistrationStats()
 *
 * ── REAL BACKEND ──────────────────────────────────────────────────────────────
 * To go live: delete the MOCK block in each function and uncomment the REAL block.
 * No changes needed in EventDetail.tsx, Registrations.tsx, etc.
 *
 * Status code alignment (frontend type → DB value):
 *   PaymentStatus: "Pending"→'P'  "Success"→'S'  "PartiallyRefunded"→'PR'
 *                  "FullyRefunded"→'FR'  "Failed"→'F'  "Cancelled"→'X'
 *   ItemStatus:    "Pending"→'P'  "Success"→'S'  "Refunded"→'R'
 *   RefundStatus:  "Pending"→'P'  "Success"→'S'  "Failed"→'F'
 */

import { ok, err, delay, paginate, API_BASE, publicHeaders, adminHeaders, parseError, apiFetch } from "./_base";
import type { ApiResult, PageParams, PagedResult } from "./_base";
import type {
  Registration, ParticipantGroup, Payment, PaymentItem,
  Refund, CheckoutSession, PaymentStatus, RegistrationStats,
  WebhookFailure, PaymentAuditEntry, OrphanRefundHistory,
} from "@/types/registration";

// ── Filter params ─────────────────────────────────────────────────────────────

export interface RegistrationFilters {
  eventId?:   string;
  programId?: string;
  regStatus?: string;
  payStatus?: string;
  search?:    string;
  dateFrom?:  string;
  dateTo?:    string;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS — no login required
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/registrations
 * Public: creates a new registration (status=Pending, payment=Pending).
 * Called by EventDetail.tsx when the user submits their cart.
 * Does NOT initiate checkout — call apiInitiateCheckout() next.
 */
export async function apiCreateRegistration(
  payload: Record<string, unknown>,
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("CREATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * POST /api/Payment/create-checkout-session
 * Public: creates a Stripe checkout session for a Pending registration.
 * Returns CheckoutSession.checkoutUrl — redirect the user there immediately.
 *
 * paymentMethod: "card" | "paynow"
 *   "card"   → Stripe hosted checkout (credit card)
 *   "paynow" → Stripe PayNow flow (or your own PayNow endpoint)
 *
 * ── SESSION-FIRST PAYMENT FLOW ───────────────────────────────────────────────
 * For paid registrations the frontend no longer writes a Pending registration
 * to the DB before redirecting to Stripe. Instead:
 *   1. Full cart payload is sent here as `registrationPayload`.
 *   2. Backend creates the Stripe session, embedding the payload as metadata.
 *   3. DB write (Registration + Payment) happens ONLY inside the Stripe webhook
 *      after payment is confirmed — no dirty Pending records ever exist.
 *   4. Stripe embeds the real registrationId in the return URL via metadata.
 *   5. On cancel/failure no DB record exists — user retries from sessionStorage.
 *
 * For free registrations, registrationPayload is omitted and registrationId is
 * passed instead (DB write happens before calling this, no gateway involved).
 */
export async function apiInitiateCheckout(
  registrationId: string,
  paymentMethod:  "card" | "paynow" = "card",
  registrationPayload?: object,   // full cart payload — session-first paid flow only
  eventId?: string,               // used to build cancel return URL for retry routing
): Promise<ApiResult<CheckoutSession>> {
  await delay();

  const isPaidFlow = !!registrationPayload;

  const body = isPaidFlow
    ? {
        // Session-first: backend creates Stripe session only.
        // Full payload NOT sent here — it lives in browser sessionStorage.
        // Backend computes amount from registrationPayload for security,
        // then discards it. DB insert happens in confirm-session after Stripe success.
        registrationPayload,  // backend uses this to compute amount only
        paymentMethod,
        successUrl: `${window.location.origin}/payment/result?status=success${eventId ? `&event=${eventId}` : ""}`,
        cancelUrl:  `${window.location.origin}/payment/result?status=cancel${eventId ? `&event=${eventId}` : ""}`,
      }
    : {
        registrationId: Number(registrationId),
        paymentMethod,
        successUrl: `${window.location.origin}/payment/result?status=success&reg=${registrationId}`,
        cancelUrl:  `${window.location.origin}/payment/result?status=cancel&reg=${registrationId}`,
      };

  const res = await apiFetch(`${API_BASE}/api/Payment/create-checkout-session`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return err("CHECKOUT_FAILED", (await parseError(res)).message);
  const data = await res.json();
  return ok({
    registrationId:   String(data.registrationId ?? registrationId ?? ""),
    paymentId:        String(data.paymentId ?? ""),
    checkoutUrl:      data.checkoutUrl ?? data.url,
    gatewaySessionId: data.gatewaySessionId ?? data.sessionId ?? "",
    expiresAt:        data.expiresAt ?? new Date(Date.now() + 86400000).toISOString(),
  });
}

/**
 * POST /api/Payment/confirm-session
 * Public: called by PaymentResult.tsx after Stripe redirects back with success.
 *
 * This is the ONLY point where Registration + Payment are written to the DB.
 * The backend must:
 *   1. Verify the gatewaySessionId with Stripe (confirm payment_status = "paid")
 *   2. Insert Registration, ParticipantGroups, Participants, Payment, PaymentItems
 *   3. Generate receipt number
 *   4. Send confirmation email to contactEmail
 *   5. Return the new registrationId
 *
 * Idempotent: if a Registration already exists for this gatewaySessionId,
 * return the existing registrationId without re-inserting.
 *
 * 409 Conflict = CHECKOUT_CONTEXT_MISSING: the webhook already processed this
 * session and purged the PendingCheckout row before the browser returned.
 * This is NOT a failure — the registration exists or is being finalised.
 * Returned as alreadyProcessed: true so the UI shows "processing" not "error".
 */
export async function apiConfirmSession(
  gatewaySessionId: string,
  registrationPayload: object,
): Promise<ApiResult<{ registrationId: string; alreadyProcessed?: boolean }>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/Payment/confirm-session`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify({ gatewaySessionId, registrationPayload }),
  });

  // 409 Conflict = backend returned CHECKOUT_CONTEXT_MISSING.
  // The webhook beat the browser back and already finalised this session.
  // The registration is in DB (or being written) — treat as PROCESSING, not failure.
  if (res.status === 409) {
    return ok({ registrationId: "", alreadyProcessed: true });
  }

  if (!res.ok) return err("CONFIRM_FAILED", (await parseError(res)).message);
  const data = await res.json();
  return ok({ registrationId: String(data.registrationId) });
}


export async function apiGetRegistration(id: string): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${id}`, {
    headers: publicHeaders(),
  });
  if (!res.ok) return err("NOT_FOUND", (await parseError(res)).message);
  return ok(await res.json());
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS — require Bearer token
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/registrations
 * Admin: paged list with filters. Used by Registrations.tsx admin table.
 */
export async function apiGetRegistrations(
  filters?: RegistrationFilters,
  page?: PageParams,
): Promise<ApiResult<PagedResult<Registration>>> {
  await delay();

  const p = new URLSearchParams();
  if (filters?.eventId)   p.set("eventId",   filters.eventId);
  if (filters?.programId) p.set("programId", filters.programId);
  if (filters?.regStatus) p.set("regStatus", filters.regStatus);
  if (filters?.payStatus) p.set("payStatus", filters.payStatus);
  if (filters?.search)    p.set("search",    filters.search);
  if (page)               { p.set("page", String(page.page)); p.set("pageSize", String(page.pageSize)); }
  const res = await apiFetch(`${API_BASE}/api/registrations?${p}`, { headers: adminHeaders() });
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * PATCH /api/registrations/:id/status
 * Admin: change the overall registration status.
 */
export async function apiUpdateRegistrationStatus(
  id: string,
  status: Registration["regStatus"],
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${id}/status`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * PATCH /api/registrations/:id/groups/:gid/status
 * Admin: change the status of one ParticipantGroup.
 */
export async function apiUpdateGroupStatus(
  registrationId: string,
  groupId: string,
  status: ParticipantGroup["groupStatus"],
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/groups/${groupId}/status`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * PATCH /api/registrations/:id/groups/:gid/seed
 * Admin: assign or clear the seed number for a ParticipantGroup.
 */
export async function apiUpdateGroupSeed(
  registrationId: string,
  groupId: string,
  seed: number | null,
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/groups/${groupId}/seed`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ seed }),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * GET /api/registrations/:id/payment
 * Admin: returns the payment record + items without the full registration.
 */
export async function apiGetPayment(registrationId: string): Promise<ApiResult<Payment>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/payment`, {
    headers: adminHeaders(),
  });
  if (!res.ok) return err("NOT_FOUND", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * GET /api/registrations/:id/payment/audit
 * Admin: returns audit entries for the registration payment.
 */
export async function apiGetPaymentAudit(registrationId: string): Promise<ApiResult<PaymentAuditEntry[]>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/payment/audit`, {
    headers: adminHeaders(),
  });
  if (!res.ok) return err("NOT_FOUND", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * PATCH /api/registrations/:id/payment
 * Admin: manually record or update payment (Cash, Bank Transfer, PayNow receipt).
 * When status = "Success": backend stamps paidAt, generates receiptNo, flips items → S,
 * queues SendConfirmationEmail + GenerateReceipt background jobs.
 */
export async function apiUpdatePayment(
  registrationId: string,
  patch: Partial<Pick<Payment, "method" | "gateway" | "paymentStatus" | "receiptNo" | "paidAt">>
    & { adminNote?: string },
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/payment`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * GET /api/registrations/:id/payment/refunds
 * Admin: returns all Refund records for a payment.
 */
export async function apiGetRefunds(registrationId: string): Promise<ApiResult<Refund[]>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/payment/refunds`, {
    headers: adminHeaders(),
  });
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * POST /api/registrations/:id/payment/refunds
 * Admin: initiates a refund on a specific PaymentItem.
 * Backend queues ProcessGatewayRefund job → Stripe → webhook flips status.
 *
 * DB constraints enforced:
 *   1. PaymentItem.ItemStatus must be 'S' (only paid items refundable)
 *   2. No existing Pending refund for the same PaymentItemID
 *      (UQ_Refunds_OneActivePerItem filtered unique index)
 *   3. refundAmount ≤ PaymentItem.Amount
 */
export async function apiInitiateRefund(
  registrationId: string,
  paymentItemId:  string,
  refundAmount:   number,
  refundReason:   string,
  requestedBy:    string,
): Promise<ApiResult<Refund>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/payment/refunds`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ paymentItemId: Number(paymentItemId), refundAmount, refundReason }),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}

export async function apiCancelRegistrationWithRefunds(
  registrationId: string,
  reason: string,
): Promise<ApiResult<{ registration: Registration; errors: string[] }>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/cancel-with-refunds`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}



/**
 * PATCH /api/registrations/:id/participants/:pid
 * Admin: update individual participant details.
 * Returns the full registration (with updated participant data).
 */
export async function apiUpdateParticipant(
  registrationId: string,
  participantId:  string,
  patch: {
    fullName?:          string;
    dob?:               string;   // "YYYY-MM-DD"
    gender?:            string;
    nationality?:       string;
    clubSchoolCompany?: string;
    email?:             string;
    contactNumber?:     string;
    tshirtSize?:        string;
    sbaId?:             string;
    guardianName?:      string;
    guardianContact?:   string;
    remark?:            string;
    customFieldValues?: Record<string, string>;
    documentUrl?:       string;
  },
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(
    `${API_BASE}/api/registrations/${registrationId}/participants/${participantId}`,
    {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) return err("UPDATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * POST /api/registrations/:id/confirm
 * Admin: confirm a registration directly, bypassing online payment.
 *
 * paymentStatus:
 *   "S"  = Paid — admin has collected payment manually
 *   "W"  = Waived — fee waived (VIP, staff, error correction)
 *   "PC" = Pending Collection — registered now, pays later
 *
 * method: required only when paymentStatus is "S"
 * paymentReference: optional manual receipt/txn ref number for "S"
 * adminNote: required remark explaining the confirmation
 */
export async function apiConfirmRegistration(
  registrationId: string,
  payload: {
    paymentStatus:     "S" | "W" | "PC";
    method?:           string;
    paymentReference?: string;
    adminNote:         string;
  },
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(
    `${API_BASE}/api/registrations/${registrationId}/confirm`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) return err("CONFIRM_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * GET /api/registrations/export
 * Admin: raw data for CSV export.
 */
export async function apiExportRegistrations(
  eventId?: string,
  programId?: string,
): Promise<ApiResult<Registration[]>> {
  await delay();

  const p = new URLSearchParams();
  if (eventId && eventId !== "all") p.set("eventId", eventId);
  if (programId) p.set("programId", programId);
  const res = await apiFetch(`${API_BASE}/api/registrations/export?${p}`, { headers: adminHeaders() });
  if (!res.ok) return err("EXPORT_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * GET /api/registrations/stats
 * Admin: aggregate counts for the Dashboard.
 */
export async function apiGetRegistrationStats(
  eventId?: string,
): Promise<ApiResult<RegistrationStats>> {
  await delay();

  const p = eventId ? `?eventId=${eventId}` : "";
  const res = await apiFetch(`${API_BASE}/api/registrations/stats${p}`, { headers: adminHeaders() });
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}


export async function apiGetReconciliationStats(): Promise<
  ApiResult<{ caseA: number; caseB: number; caseC: number; total: number }>
> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/stats`,
    { headers: adminHeaders() },
  );
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}
 
// ── GET /api/admin/payment-reconciliation/webhook-failures ────────────────────
// Returns Case-C rows for the "Unmatched Stripe Payments" tab.
export async function apiGetWebhookFailures(): Promise<ApiResult<WebhookFailure[]>> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/webhook-failures`,
    { headers: adminHeaders() },
  );
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}
 
// ── POST /api/admin/payment-reconciliation/webhook-failures/{id}/refund ────────
// Issues a Stripe refund for an unmatched payment (Case C).
export async function apiGetOrphanRefundHistory(): Promise<ApiResult<OrphanRefundHistory[]>> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/refund-history`,
    { headers: adminHeaders() },
  );
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiRefundOrphanedPayment(
  webhookLogId: number,
  reason: string,
  adminNote: string,
): Promise<ApiResult<{ refundId: number; refundStatus: string; gatewayRefundId: string }>> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/webhook-failures/${webhookLogId}/refund`,
    {
      method:  "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body:    JSON.stringify({ reason, adminNote }),
    },
  );
  if (!res.ok) return err("REFUND_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}
