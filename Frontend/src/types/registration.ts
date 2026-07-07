/**
 * registration.ts — Complete registration data schema
 *
 * Hierarchy:
 *   Registration (one form submission, one contact, covers N programs)
 *   └── ParticipantGroup[] (one per program — this is the fixture SeedEntry unit)
 *       ├── Participant[]   (1 = singles, 2 = doubles, N = team)
 *       └── PaymentItem     (fee for this program slot)
 *
 * Key links:
 *   ParticipantGroup.id  === SeedEntry.id  (fixture system uses this)
 *   Registration.id      === receipt grouping
 *
 * Payment model (mirrors DB schema exactly):
 *   One Payment per Registration — one checkout session, one receipt.
 *   One PaymentItem per ParticipantGroup — individual line items.
 *   Refunds are a separate first-class entity tied to a PaymentItem,
 *   NOT embedded inside it. This matches the DB Refunds table.
 *
 * ── STATUS CODE ALIGNMENT WITH DB ────────────────────────────────────────────
 *
 *   PaymentStatus  (Payment.paymentStatus)       DB column: Payments.PaymentStatus VARCHAR(2)
 *     "Pending"           → 'P'   Checkout created, awaiting payment
 *     "Success"           → 'S'   Fully paid, webhook confirmed
 *     "PartiallyRefunded" → 'PR'  At least one item refunded, not all
 *     "FullyRefunded"     → 'FR'  All items refunded
 *     "Failed"            → 'F'   Gateway failure / timeout
 *     "Cancelled"         → 'X'   User abandoned or admin voided
 *
 *   ItemStatus     (PaymentItem.itemStatus)       DB column: PaymentItems.ItemStatus VARCHAR(2)
 *     "Pending"           → 'P'   Item in cart, payment not confirmed
 *     "Success"           → 'S'   Payment confirmed by webhook
 *     "Refunded"          → 'R'   Refund confirmed by gateway
 *     "Cancelled"         → 'X'   Cancelled without refund
 *
 *   RefundStatus   (Refund.refundStatus)          DB column: Refunds.RefundStatus CHAR(1)
 *     "Pending"           → 'P'   Refund initiated, awaiting gateway
 *     "Success"           → 'S'   Gateway confirmed refund
 *     "Failed"            → 'F'   Gateway rejected refund
 *
 * ── TRANSITION RULES (enforce in service layer, not in frontend) ─────────────
 *   PaymentStatus:  Pending → Success | Failed | Cancelled
 *                   Success → PartiallyRefunded → FullyRefunded
 *   ItemStatus:     Pending → Success → Refunded
 *                              Success → Cancelled
 *   RefundStatus:   Pending → Success | Failed
 *
 *   After any PaymentItem → Refunded:
 *     ALL items Refunded  → Payment.paymentStatus = FullyRefunded
 *     SOME items Refunded → Payment.paymentStatus = PartiallyRefunded
 */

export type RegStatus = "Pending" | "Confirmed" | "CancelPending" | "RefundFailed" | "Cancelled";

// ── Payment / refund status codes ─────────────────────────────────────────────
// These match the DB schema exactly. UI badge components translate to
// human-readable labels (e.g. "Success" → "Paid", "FullyRefunded" → "Refunded").

export type PaymentStatus =
  | "P"    // Pending
  | "S"    // Paid (Success)
  | "PR"   // Partially Refunded
  | "FR"   // Fully Refunded
  | "F"    // Failed
  | "X"    // Cancelled
  | "W"    // Waived (admin waived fee)
  | "PC";  // Pending Collection (will pay later)

export type ItemStatus =
  | "P"
  | "S"
  | "R"
  | "X";

export type ParticipantStatus =
  | "Active"
  | "Cancelled";

export type RefundStatus =
  | "P"
  | "S"
  | "F";

export type PaymentMethod =
  | "CreditCard"    // DB: 'CreditCard'
  | "PayNow"        // DB: 'PayNow'
  | "Free"          // DB: 'Free'
  | "Cash"          // DB: 'Cash'
  | "BankTransfer"  // DB: 'BankTransfer'
  | "Others";       // DB: 'Others'

export type PaymentGateway = "Stripe" | "PayNow" | "Manual";

// ── UI display helpers ────────────────────────────────────────────────────────
// Translate DB-aligned codes → human labels for badge components.
// Keep translation HERE so badge components don't each do their own mapping.

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  P:  "Pending",
  S:  "Paid",
  PR: "Partially Refunded",
  FR: "Refunded",
  F:  "Failed",
  X:  "Cancelled",
  W:  "Waived",
  PC: "Pending Collection",
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  P: "Pending",
  S: "Paid",
  R: "Refunded",
  X: "Cancelled",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CreditCard:  "Credit Card",
  PayNow:      "PayNow",
  Free:        "Free",
  Cash:        "Cash",
  BankTransfer:"Bank Transfer",
  Others:      "Others",
};

// ── Participant (one person) ───────────────────────────────────────────────────

export interface RegistrationParticipant {
  id:                  string;   // "PART-001" → DB: Participants.ParticipantID
  participantGroupId:  string;   // FK → ParticipantGroup.id
  fullName:            string;
  dob:                 string;   // "YYYY-MM-DD"
  gender:              string;
  nationality:         string;
  clubSchoolCompany:   string;
  email?:              string;
  contactNumber?:      string;
  tshirtSize?:         string;
  sbaId?:              string;
  guardianName?:       string;
  guardianContact?:    string;
  remark?:             string;
  documentUrl?:        string;
  participantStatus?:  ParticipantStatus;
  customFieldValues:   Record<string, string>;
}

// ── ParticipantGroup (one fixture entry — singles/doubles/team) ────────────────
// The id of this entity is reused as SeedEntry.id in the fixture system.
// This is the critical link: fixture entries are identified by ParticipantGroup.id.

export interface ParticipantGroup {
  id:              string;   // "PG-001" → DB: ParticipantGroups.GroupID
                             // ↑ Also used as SeedEntry.id in fixture engine
  registrationId:  string;   // FK → Registration.id
  eventId:         string;   // FK → Event.id (denormalised)
  programId:       string;   // FK → Program.id
  programName:     string;   // Snapshotted at checkout (receipt stability)
  fee:             number;   // Total fee for this group slot
  groupStatus:     RegStatus;
  seed:            number | null;
  participants:    RegistrationParticipant[];
  // Derived display fields (computed + stored for query performance)
  clubDisplay:     string;   // First participant's club
  namesDisplay:    string;   // e.g. "Lee Wei Jie / Tan Ah Kow"
}

// ── PaymentItem (one per ParticipantGroup) ────────────────────────────────────
// Maps to DB: PaymentItems table.
// itemStatus tracks individual confirmation/refund state per line.

export interface PaymentItem {
  id:                  string;       // "PI-001" → DB: PaymentItems.PaymentItemID
  paymentId:           string;       // FK → Payment.id
  participantGroupId:  string;       // FK → ParticipantGroup.id
  participantId?:      string;       // Only set when feeStructure = "per_player"
  programName:         string;       // Snapshotted at checkout
  description:         string;       // e.g. "Men's Doubles – Ali & Bob"
  playerName?:         string;       // Display label when per_player
  amount:              number;       // Snapshotted fee — not affected by future changes
  itemStatus:          ItemStatus;   // DB: PaymentItems.ItemStatus
}

// ── Refund (first-class entity — NOT embedded in PaymentItem) ─────────────────
// Maps to DB: Refunds table.
// One Refund row per refund action on a specific PaymentItem.
// DB constraint: only one Pending refund per PaymentItem at a time.

export interface Refund {
  id:               string;        // "REF-001" → DB: Refunds.RefundID
  paymentId:        string;        // FK → Payment.id
  paymentItemId:    string;        // FK → PaymentItem.id
  gateway:          PaymentGateway;
  gatewayRefundId?: string;        // Stripe: re_xxxx — populated when Success
  refundAmount:     number;        // May be ≤ PaymentItem.amount
  refundReason?:    string;        // e.g. "Withdrawal from program"
  refundStatus:     RefundStatus;  // DB: Refunds.RefundStatus
  requestedBy?:     string;        // Admin username
  approvedBy?:      string;        // Admin username
  createdAt:        string;        // ISO datetime
  processedAt?:     string;        // Populated when Success
}

// ── Payment (one per Registration, one checkout session) ──────────────────────
// Maps to DB: Payments table.
// Gateway fields are populated when the checkout session is created.
// Receipt number is generated only when paymentStatus → Success.

export interface Payment {
  id:                    string;          // "PAY-001" → DB: Payments.PaymentID
  registrationId:        string;          // FK → Registration.id
  eventId:               string;          // FK → Event.id (denormalised)
  // Gateway
  gateway:               PaymentGateway;  // DB: Payments.PaymentGateway
  gatewaySessionId?:     string;          // DB: Payments.GatewaySessionID (Stripe: cs_xxxx)
  gatewayPaymentId?:     string;          // DB: Payments.GatewayPaymentID (Stripe: pi_xxxx)
  gatewayChargeId?:      string;          // DB: Payments.GatewayChargeID  (Stripe: ch_xxxx)
  // Payment details
  method:                PaymentMethod | null; // DB: Payments.PaymentMethod
  amount:                number;          // Total = SUM(items[].amount)
  currency:              string;          // DB: Payments.Currency (default: "SGD")
  paymentStatus:         PaymentStatus;   // DB: Payments.PaymentStatus
  // Receipt
  receiptNo?:            string;          // "TRS-YYYYMMDD-XXXXX" — generated on Success
  adminNote?:            string;          // admin remark stored on manual confirm/waive
  // Timestamps
  createdAt:             string;
  paidAt?:               string;          // Populated when Success
  // Line items (fetched with payment; not a separate API call)
  items:                 PaymentItem[];
}

export interface PaymentAuditEntry {
  id:          string;
  entityType:  string;
  entityId:    string;
  action:      string;
  oldStatus?:  string | null;
  newStatus?:  string | null;
  reason?:     string | null;
  performedBy?: string | null;
  ipAddress?:  string | null;
  notes?:      string | null;
  createdAt:   string;
}

// ── Registration (one form submission) ────────────────────────────────────────

export interface Registration {
  id:              string;   // "REG-001" → DB: EventRegistrations.RegistrationID
  eventId:         string;
  eventName:       string;   // Denormalised for display
  submittedAt:     string;   // ISO datetime
  regStatus:       RegStatus;
  // Contact person (who submitted the form)
  contactName:     string;
  contactEmail:    string;
  contactPhone:    string;
  // Programs enrolled (one group per program)
  groups:          ParticipantGroup[];
  // Payment (one receipt covers all programs in this submission)
  payment:         Payment;
}



// ── Dashboard / stats aggregate ───────────────────────────────────────────────
// Returned by apiGetRegistrationStats(). Defined here (not in registrationsApi.ts)
// so it can be imported from the canonical types file alongside Registration, Payment, etc.

export interface RegistrationStats {
  totalRegistrations: number;
  confirmed:          number;
  pending:            number;
  cancelled:          number;
  totalRevenue:       number;
  pendingPayments:    number;   // kept for backward compat — same as caseA
  // Payment reconciliation counts (new)
  caseA:  number;   // Confirmed reg, pending payment
  caseB:  number;   // Pending reg, payment succeeded
  caseC:  number;   // Stripe paid, no registration at all
  reconciliationTotal: number;  // caseA + caseB + caseC
}


// Case-C row returned by GET /api/admin/payment-reconciliation/webhook-failures
export interface WebhookFailure {
  webhookLogId:     number;
  gatewaySessionId: string;
  errorMessage:     string | null;
  receivedAt:       string;
  retryCount:       number;
  amount:           number | null;
  currency:         string;
  contactName:      string | null;
  contactEmail:     string | null;
  contactPhone:     string | null;
}

export interface OrphanRefundHistory {
  refundId:         number;
  webhookLogId:     number | null;
  gatewaySessionId: string | null;
  gatewayRefundId:  string | null;
  refundAmount:     number;
  currency:         string;
  refundReason:     string | null;
  refundStatus:     RefundStatus;
  requestedBy:      string | null;
  approvedBy:       string | null;
  createdAt:        string;
  processedAt:      string | null;
  contactName:      string | null;
  contactEmail:     string | null;
  contactPhone:     string | null;
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Flatten a registration into SeedEntry-compatible objects for the fixture wizard */
export function groupsToSeedEntries(groups: ParticipantGroup[]) {
  return groups
    .filter(g => g.groupStatus !== "Cancelled")
      .map(g => {
        const activeParticipants = g.participants.filter(p => p.participantStatus !== "Cancelled");
        return {
        id:           g.id,          // ParticipantGroup.id IS the SeedEntry.id
        club:         g.clubDisplay,
        participants: activeParticipants.map(p => p.fullName),
        seed:         g.seed,
        sbaId:        activeParticipants[0]?.sbaId,
        sbaIds:       activeParticipants.map(p => p.sbaId).filter((id): id is string => !!id),
        registrationId: g.registrationId,
        groupId:        g.id,
      };
    });
}

/** Total fee for a registration */
export function totalFee(reg: Registration): number {
  return reg.payment.items.reduce((s, item) => s + item.amount, 0);
}

/** Total confirmed-refunded amount for a registration (requires refunds to be fetched separately) */
export function totalRefunded(refunds: Refund[]): number {
  return refunds
    .filter(r => r.refundStatus === "S")
    .reduce((s, r) => s + r.refundAmount, 0);
}

/** All participant names across all groups in a registration */
export function allParticipantNames(reg: Registration): string[] {
  return reg.groups.flatMap(g => g.participants
    .filter(p => p.participantStatus !== "Cancelled")
    .map(p => p.fullName));
}

/** Whether a PaymentItem can have a new refund initiated */
export function canRefundItem(item: PaymentItem, activeRefunds: Refund[]): boolean {
  if (item.itemStatus !== "S") return false;  // Only successful items are refundable
  const hasPending = activeRefunds.some(
    r => r.paymentItemId === item.id && r.refundStatus === "P"
  );
  return !hasPending;  // DB constraint: one Pending refund per item at a time
}

export type PaymentAttemptStatus =
  | "Created"
  | "Submitted"
  | "Succeeded"
  | "Failed"
  | "Expired"
  | "Canceled"
  | "NeedsReconciliation";

export interface EmbeddedPaymentAttempt {
  paymentAttemptId: number;
  attemptKey: string;
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  status: PaymentAttemptStatus;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  expiresAt: string;
}

export interface EmbeddedPaymentAttemptStatus {
  paymentAttemptId: number;
  status: PaymentAttemptStatus;
  expiresAt: string;
  registrationId: number | null;
  paymentId: number | null;
  reconciliationReason: string | null;
  errorMessage: string | null;
}
