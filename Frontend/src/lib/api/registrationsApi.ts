/**
 * registrationsApi.ts - Registration, Payment & Refund management.
 *
 *  AUTH SPLIT
 *
 *  PUBLIC  (no login required):
 *  apiCreateRegistration()  POST /api/registrations
 *  apiCreateEmbeddedPaymentAttempt() POST /api/Payment/embedded-attempt
 *  apiGetRegistration()  GET  /api/registrations/:id  (receipt lookup)
 *
 *  ADMIN  (requires Bearer token):
 *  apiGetRegistrations()  GET  /api/registrations  (admin list)
 *  apiUpdateRegistrationStatus()
 *  apiUpdateGroupStatus()
 *  apiUpdateGroupSeed()
 *  apiGetPayment()
 *  apiUpdatePayment()
 *  apiGetRefunds()
 *  apiInitiateRefund()
 *  apiExportRegistrations()
 *  apiGetRegistrationStats()
 *
 *  REAL BACKEND
 * To go live: delete the MOCK block in each function and uncomment the REAL block.
 * No changes needed in EventDetail.tsx, Registrations.tsx, etc.
 *
 * Status code alignment (frontend type -> DB value):
 *  PaymentStatus: "Pending"->'P'  "Success"->'S'  "PartiallyRefunded"->'PR'
 *  "FullyRefunded"->'FR'  "Failed"->'F'  "Cancelled"->'X'
 *  ItemStatus:  "Pending"->'P'  "Success"->'S'  "Refunded"->'R'
 *  RefundStatus:  "Pending"->'P'  "Success"->'S'  "Failed"->'F'
 */

import { ok, err, delay, paginate, API_BASE, publicHeaders, adminHeaders, parseError, apiFetch } from "./_base";
import type { ApiResult, PageParams, PagedResult } from "./_base";
import type {
  Registration, ParticipantGroup, Payment, PaymentItem,
  Refund, PaymentStatus, RefundMethod, RefundSource, RegistrationStats,
  WebhookFailure, PaymentAuditEntry, OrphanRefundHistory,
  EmbeddedPaymentAttempt, EmbeddedPaymentAttemptStatus,
} from "@/types/registration";

//  Filter params

export interface RegistrationFilters {
  eventId?:   string;
  programId?: string;
  regStatus?: string;
  payStatus?: string;
  search?:    string;
  dateFrom?:  string;
  dateTo?:    string;
}


// PUBLIC ENDPOINTS - no login required


/**
 * POST /api/registrations
 * Public: creates a registration directly.
 * Used for free registrations; paid public registrations use embedded
 * payment attempts and are finalized by Stripe webhook processing.
 */
export async function apiCreateRegistration(
  payload: Record<string, unknown>,
  options?: { admin?: boolean },
): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations`, {
    method: "POST",
    headers: options?.admin ? adminHeaders() : publicHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return err("CREATE_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

/**
 * POST /api/Payment/confirm-session
 * Legacy hosted Checkout fallback used by PaymentResult when returning from an
 * older Stripe Checkout Session. New paid public registrations use embedded
 * payment attempts instead.
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
  // The registration is in DB (or being written) - treat as PROCESSING, not failure.
  if (res.status === 409) {
    return ok({ registrationId: "", alreadyProcessed: true });
  }

  if (!res.ok) return err("CONFIRM_FAILED", (await parseError(res)).message);
  const data = await res.json();
  return ok({ registrationId: String(data.registrationId) });
}

export async function apiCreateEmbeddedPaymentAttempt(
  registrationPayload: object,
  paymentMethod: "card" | "paynow",
  attemptKey: string,
): Promise<ApiResult<EmbeddedPaymentAttempt>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/Payment/embedded-attempt`, {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify({ registrationPayload, paymentMethod, attemptKey }),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}

export async function apiSubmitEmbeddedPaymentAttempt(
  paymentAttemptId: number,
): Promise<ApiResult<{ status: string }>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/Payment/embedded-attempt/${paymentAttemptId}/submit`, {
    method: "POST",
    headers: publicHeaders(),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}

export async function apiGetEmbeddedPaymentAttemptStatus(
  paymentAttemptId: number,
): Promise<ApiResult<EmbeddedPaymentAttemptStatus>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/Payment/embedded-attempt/${paymentAttemptId}/status`, {
    headers: publicHeaders(),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}

export async function apiAbandonEmbeddedPaymentAttempt(
  paymentAttemptId: number,
): Promise<ApiResult<EmbeddedPaymentAttemptStatus>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/Payment/embedded-attempt/${paymentAttemptId}/abandon`, {
    method: "POST",
    headers: publicHeaders(),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}


export async function apiGetRegistration(id: string): Promise<ApiResult<Registration>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${id}`, {
    headers: publicHeaders(),
  });
  if (!res.ok) return err("NOT_FOUND", (await parseError(res)).message);
  return ok(await res.json());
}


// ADMIN ENDPOINTS - require Bearer token


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
 * When status = "Success": backend stamps paidAt, generates receiptNo, flips items -> S,
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
 * Backend queues ProcessGatewayRefund job -> Stripe -> webhook flips status.
 *
 * DB constraints enforced:
 *  1. PaymentItem.ItemStatus must be 'S' (only paid items refundable)
 *  2. No existing Pending refund for the same PaymentItemID
 *  (UQ_Refunds_OneActivePerItem filtered unique index)
 *  3. refundAmount <= PaymentItem.Amount
 */
export async function apiInitiateRefund(
  registrationId: string,
  paymentItemId:  string,
  refundAmount:   number,
  refundReason:   string,
  requestedBy:    string,
  options?: {
    refundSource?: RefundSource;
    refundMethod?: RefundMethod;
    refundReference?: string;
    adminNote?: string;
  },
): Promise<ApiResult<Refund>> {
  await delay();

  const res = await apiFetch(`${API_BASE}/api/registrations/${registrationId}/payment/refunds`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      paymentItemId: Number(paymentItemId),
      refundAmount,
      refundReason,
      refundSource: options?.refundSource,
      refundMethod: options?.refundMethod,
      refundReference: options?.refundReference,
      adminNote: options?.adminNote,
    }),
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

export type CancellationRefundMode = "none" | "refundPaidItems";

export interface CancellationResponse {
  registration: Registration;
  errors: string[];
  fixtureImpact?: Array<{
    programId: number;
    isLocked: boolean;
    severity: string;
    message: string;
  }>;
}

async function postCancellation(
  url: string,
  reason: string,
  refundMode: CancellationRefundMode,
  options?: {
    refundSource?: RefundSource;
    refundMethod?: RefundMethod;
    refundReference?: string;
    adminNote?: string;
  },
): Promise<ApiResult<CancellationResponse>> {
  await delay();

  const res = await apiFetch(url, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      reason,
      refundMode,
      refundSource: options?.refundSource,
      refundMethod: options?.refundMethod,
      refundReference: options?.refundReference,
      adminNote: options?.adminNote,
    }),
  });
  if (!res.ok) {
    const e = await parseError(res);
    return err(e.code, e.message);
  }
  return ok(await res.json());
}

export async function apiCancelRegistration(
  registrationId: string,
  reason: string,
  refundMode: CancellationRefundMode,
  options?: {
    refundSource?: RefundSource;
    refundMethod?: RefundMethod;
    refundReference?: string;
    adminNote?: string;
  },
): Promise<ApiResult<CancellationResponse>> {
  return postCancellation(
    `${API_BASE}/api/registrations/${registrationId}/cancel`,
    reason,
    refundMode,
    options,
  );
}

export async function apiCancelRegistrationGroup(
  registrationId: string,
  groupId: string,
  reason: string,
  refundMode: CancellationRefundMode,
  options?: {
    refundSource?: RefundSource;
    refundMethod?: RefundMethod;
    refundReference?: string;
    adminNote?: string;
  },
): Promise<ApiResult<CancellationResponse>> {
  return postCancellation(
    `${API_BASE}/api/registrations/${registrationId}/groups/${groupId}/cancel`,
    reason,
    refundMode,
    options,
  );
}

export async function apiCancelRegistrationParticipant(
  registrationId: string,
  participantId: string,
  reason: string,
  refundMode: CancellationRefundMode,
  options?: {
    refundSource?: RefundSource;
    refundMethod?: RefundMethod;
    refundReference?: string;
    adminNote?: string;
  },
): Promise<ApiResult<CancellationResponse>> {
  return postCancellation(
    `${API_BASE}/api/registrations/${registrationId}/participants/${participantId}/cancel`,
    reason,
    refundMode,
    options,
  );
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
 *  "S"  = Paid - admin has collected payment manually
 *  "W"  = Waived - fee waived (VIP, staff, error correction)
 *  "PC" = Pending Collection - registered now, pays later
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
 
//  GET /api/admin/payment-reconciliation/webhook-failures
// Returns Case-C rows for the "Unmatched Stripe Payments" tab.
export async function apiGetWebhookFailures(): Promise<ApiResult<WebhookFailure[]>> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/webhook-failures`,
    { headers: adminHeaders() },
  );
  if (!res.ok) return err("FETCH_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}
 
//  POST /api/admin/payment-reconciliation/webhook-failures/{id}/refund
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

export async function apiRecordExternalOrphanRefund(
  webhookLogId: number,
  amount: number | null,
  refundMethod: RefundMethod,
  refundReference: string,
  reason: string,
  adminNote: string,
): Promise<ApiResult<{ refundId: number; refundStatus: string; refundAmount: number; gatewayRefundId: string | null }>> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/webhook-failures/${webhookLogId}/external-refund`,
    {
      method:  "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body:    JSON.stringify({ amount, refundMethod, refundReference, reason, adminNote }),
    },
  );
  if (!res.ok) return err("EXTERNAL_REFUND_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}

export async function apiMarkWebhookFailureReviewed(
  webhookLogId: number,
  note: string,
): Promise<ApiResult<{ webhookLogId: number; gatewaySessionId: string; reviewedCount: number }>> {
  const res = await apiFetch(
    `${API_BASE}/api/admin/payment-reconciliation/webhook-failures/${webhookLogId}/reviewed`,
    {
      method:  "PATCH",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body:    JSON.stringify({ note }),
    },
  );
  if (!res.ok) return err("REVIEW_FAILED", (await parseError(res)).message);
  return ok(await res.json());
}
