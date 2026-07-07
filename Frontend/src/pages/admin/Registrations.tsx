/**
 * Registrations.tsx — Registration & Payment Management
 *
 * Primary unit: Registration (one row = one form submission).
 * Each registration can cover multiple programs (multiple ParticipantGroups).
 * One payment receipt per registration covers all programs in that submission.
 *
 * Payment Log modal — redesigned:
 *   - Full-width panel (max-w-4xl) with two-column layout
 *   - Programs grouped as cards (Registration → Program → Participant count)
 *   - Per-entry vs per-player clearly labelled with fee badge
 *   - Always shows participant count (never a long name list)
 *   - Refund timeline shows ALL statuses (P/S/F) in chronological order
 *   - Receipt download grayed out (with tooltip) when no receipt yet
 *   - Single source: both admin and user hit GET /api/registrations/:id/receipt
 */

import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  CreditCard, CheckCircle, XCircle, RefreshCw,
  Receipt, MoreVertical, Users, ExternalLink,
  Clock, AlertCircle, Download,
} from "lucide-react";
import type { TournamentEvent } from "@/types/config";
import type { Registration, ParticipantGroup, Payment, PaymentItem, Refund, PaymentMethod, PaymentStatus, PaymentAuditEntry } from "@/types/registration";
import { totalFee, PAYMENT_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/types/registration";
import {
  apiGetEvents, apiGetRegistration, apiGetRegistrations,
  apiUpdatePayment,
  apiGetRefunds, apiGetPaymentAudit, apiInitiateRefund, apiCancelRegistration, apiConfirmRegistration, assetUrl,
} from "@/lib/api";
import type { CancellationRefundMode } from "@/lib/api/registrationsApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/TableControls";
import { Switch } from "@/components/ui/switch";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ActionDropdownPortal from "@/components/ui/ActionDropdownPortal";

// ── Types ─────────────────────────────────────────────────────────────────────

type RegStatus = "Pending" | "Confirmed" | "CancelPending" | "RefundFailed" | "Cancelled";

type SortState<T> = { key: keyof T | null; dir: "asc" | "desc" };
function useSort<T>(data: T[]) {
  const [sort, setSort] = useState<SortState<T>>({ key: null, dir: "asc" });
  const toggle = (key: keyof T) =>
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const sorted = useMemo(() => {
    if (!sort.key) return data;
    return [...data].sort((a, b) => {
      const av = String(a[sort.key!] ?? ""), bv = String(b[sort.key!] ?? "");
      return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [data, sort]);
  return { sort, toggle, sorted };
}

// ── Badges ────────────────────────────────────────────────────────────────────

function PayBadge({ status }: { status: PaymentStatus }) {
  const label = PAYMENT_STATUS_LABEL[status] ?? status;
  const m: Record<string, [string, string]> = {
    S:  ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    P:  ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    FR: ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
    PR: ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    F:  ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
    X:  ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
    W:  ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    PC: ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
  };
  const [bg, text] = m[status] ?? m.P;
  return <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: bg, color: text }}>{label}</span>;
}

function RegBadge({ status }: { status: string }) {
  const m: Record<string, [string, string]> = {
    "Confirmed":  ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    "Pending":    ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    "Cancelled":  ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [bg, text] = m[status] ?? m["Pending"];
  return <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: bg, color: text }}>{status}</span>;
}

/** Badge for refund status: P=Pending, S=Success, F=Failed */
function RefundStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; bg: string; text: string }> = {
    S: { label: "Refunded",  bg: "var(--badge-open-bg)",   text: "var(--badge-open-text)" },
    P: { label: "Pending",   bg: "var(--badge-soon-bg)",   text: "var(--badge-soon-text)" },
    F: { label: "Failed",    bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" },
  };
  const c = cfg[status] ?? cfg.P;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: c.bg, color: c.text }}>
      {status === "S" && <CheckCircle className="h-3 w-3" />}
      {status === "P" && <Clock className="h-3 w-3" />}
      {status === "F" && <AlertCircle className="h-3 w-3" />}
      {c.label}
    </span>
  );
}

function MethodIcon({ method }: { method: PaymentMethod }) {
  if (method === "CreditCard") return <CreditCard className="h-3.5 w-3.5 opacity-60" />;
  if (method === "PayNow") return <span className="text-xs font-bold px-1" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>PN</span>;
  return null;
}

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>{children}</div>;
}

function getPayment(reg: Registration | null | undefined): Payment | null {
  if (!reg) return null;
  return ((reg as Registration & { payment?: Payment | null }).payment) ?? null;
}

function programEntrySummary(groups: ParticipantGroup[]) {
  const byProgram = new Map<string, { programName: string; count: number }>();

  for (const group of groups) {
    const key = group.programId || group.programName;
    const current = byProgram.get(key);
    if (current) current.count += 1;
    else byProgram.set(key, { programName: group.programName, count: 1 });
  }

  const programs = Array.from(byProgram.values());
  return {
    programCount: programs.length,
    text: programs
      .map(p => `${p.programName} x ${p.count} ${p.count === 1 ? "entry" : "entries"}`)
      .join(", "),
  };
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sum of Success refunds for a registration/payment item list. */
function calcRefunded(refunds: Refund[], items: PaymentItem[]): number {
  return items.reduce((sum, item) => {
    const itemRefunded = refunds
      .filter(r => r.paymentItemId === item.id && r.refundStatus === "S")
      .reduce((itemSum, r) => itemSum + r.refundAmount, 0);
    return sum + itemRefunded;
  }, 0);
}

function refundableItems(payment: Payment | null | undefined, refunds: Refund[]): PaymentItem[] {
  if (!payment || !(payment.paymentStatus === "S" || payment.paymentStatus === "PR")) return [];
  if (!["Stripe", "Manual", "PayNow"].includes(payment.gateway)) return [];
  return payment.items.filter(item => {
    if (item.itemStatus !== "S") return false;
    const refunded = refunds
      .filter(r => r.paymentItemId === item.id && r.refundStatus === "S")
      .reduce((sum, r) => sum + r.refundAmount, 0);
    const pending = refunds.some(r => r.paymentItemId === item.id && r.refundStatus === "P");
    return !pending && item.amount - refunded > 0;
  });
}

// ── Payment Log helpers ───────────────────────────────────────────────────────

/**
 * Groups PaymentItems by programName, mirrors what ReceiptService.cs does.
 * Returns one entry per program with aggregated amounts and participant count.
 */
interface ProgramGroup {
  programName:      string;
  isPerPlayer:      boolean;   // true when any item has participantId set
  items:            PaymentItem[];
  participantCount: number;    // total participants across all groups for this program
  subtotal:         number;
  refundedAmount:   number;    // sum of successful refunds for this program's items
  hasRefunds:       boolean;
}

function buildProgramGroups(
  payment:  Payment,
  groups:   ParticipantGroup[],
  refunds:  Refund[],
): ProgramGroup[] {
  const byProgram = new Map<string, PaymentItem[]>();
  for (const item of payment.items) {
    const key = item.programName;
    if (!byProgram.has(key)) byProgram.set(key, []);
    byProgram.get(key)!.push(item);
  }

  return Array.from(byProgram.entries()).map(([programName, items]) => {
    const isPerPlayer = items.some(i => !!i.participantId);

    // Participant count:
    // per_player → each item = 1 participant
    // per_entry  → sum participants across the groups that belong to this program
    let participantCount: number;
    if (isPerPlayer) {
      participantCount = items.length;
    } else {
      const groupIds = new Set(items.map(i => i.participantGroupId));
      participantCount = groups
        .filter(g => groupIds.has(g.id))
        .reduce((sum, g) => sum + g.participants.length, 0);
    }

    const subtotal = items.reduce((s, i) => s + i.amount, 0);

    const refundedAmount = items.reduce((s, item) => {
      return s + refunds
        .filter(r => r.paymentItemId === item.id && r.refundStatus === "S")
        .reduce((rs, r) => rs + r.refundAmount, 0);
    }, 0);

    return {
      programName,
      isPerPlayer,
      items,
      participantCount,
      subtotal,
      refundedAmount,
      hasRefunds: refundedAmount > 0,
    };
  });
}

/**
 * Builds a flat chronological transaction timeline:
 * 1. The original payment event
 * 2. All refunds (all statuses: P/S/F) sorted by createdAt
 */
interface TimelineEntry {
  type:          "payment" | "refund";
  date:          string;
  label:         string;          // program name or "Payment confirmed"
  description?:  string;          // refund reason, admin note
  amount:        number;          // positive for payment, positive for refund amount
  status:        string;          // PaymentStatus or RefundStatus code
  gatewayRef?:   string;          // gateway refund ID or charge ID
  transactionId?: string;         // payment intent/session for payments, refund ID for refunds
  paymentMethod?: string;
}

function buildTimeline(
  payment: Payment,
  refunds: Refund[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Payment entry
  entries.push({
    type:        "payment",
    date:        payment.paidAt ?? payment.createdAt,
    label:       "Payment confirmed",
    description: payment.adminNote ?? undefined,
    amount:      payment.amount,
    status:      "S",
    gatewayRef:  payment.gatewayChargeId ?? payment.gatewayPaymentId ?? undefined,
    transactionId: payment.gatewayPaymentId ?? payment.gatewaySessionId ?? undefined,
    paymentMethod: payment.method ? (PAYMENT_METHOD_LABEL[payment.method] ?? payment.method) : undefined,
  });

  // Refund entries — all statuses
  for (const r of refunds) {
    const item = payment.items.find(i => i.id === r.paymentItemId);
    entries.push({
      type:        "refund",
      date:        r.processedAt ?? r.createdAt,
      label:       item?.programName ?? "Refund",
      description: r.refundReason ?? undefined,
      amount:      r.refundAmount,
      status:      r.refundStatus,
      gatewayRef:  r.gatewayRefundId ?? undefined,
      transactionId: r.gatewayRefundId ?? undefined,
      paymentMethod: payment.method ? (PAYMENT_METHOD_LABEL[payment.method] ?? payment.method) : undefined,
    });
  }

  // Sort chronologically
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Payment Log Modal ─────────────────────────────────────────────────────────

interface PaymentLogModalProps {
  reg:      Registration;
  refunds:  Refund[];
  onClose:  () => void;
}

function PaymentLogModal({ reg, refunds, onClose }: PaymentLogModalProps) {
  const payment = getPayment(reg);
  const [auditRows, setAuditRows] = useState<PaymentAuditEntry[]>([]);
  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
  const receiptUrl = `${API_BASE}/api/registrations/${reg.id}/receipt`;
  const hasReceipt = !!payment?.receiptNo;

  const programGroups = payment
    ? buildProgramGroups(payment, reg.groups, refunds)
    : [];
  const timeline = payment ? buildTimeline(payment, refunds) : [];
  const totalPaid = payment?.amount ?? 0;
  const totalRefunded = refunds
    .filter(r => r.refundStatus === "S")
    .reduce((s, r) => s + r.refundAmount, 0);
  const netAmount = totalPaid - totalRefunded;

  useEffect(() => {
    let active = true;
    apiGetPaymentAudit(reg.id).then(r => {
      if (active) setAuditRows(r.data ?? []);
    });
    return () => { active = false; };
  }, [reg.id]);

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="p-0"
        style={{
          maxWidth: "1280px",
          width: "98vw",
          maxHeight: "92vh",
          backgroundColor: "var(--color-page-bg)",
          border: "1px solid var(--color-table-border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Header ── */}
        <DialogHeader
          className="px-7 py-5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--color-table-border)" }}
        >
          <div>
            <DialogTitle className="font-bold text-lg">
              Payment Log — Registration {reg.id}
            </DialogTitle>
            <p className="text-xs opacity-50 mt-1">
              {reg.contactName} · {reg.eventName}
            </p>
          </div>
        </DialogHeader>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1">
          <div className="p-7 space-y-7">

            {/* Payment summary */}
            <div
              className="grid gap-4 text-sm"
              style={{
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                padding: "16px",
                border: "1px solid var(--color-table-border)",
                backgroundColor: "var(--color-row-hover)",
              }}
            >
              <MetaField label="Payer" value={reg.contactName} />
              <MetaField label="Payer Email" value={reg.contactEmail} mono />
              <MetaField label="Payer Contact" value={reg.contactPhone || "—"} />
              <MetaField label="Payment Method" value={payment?.method ? (PAYMENT_METHOD_LABEL[payment.method] ?? payment.method) : "—"} />
              <div>
                <p className="text-xs opacity-50 mb-1">Payment Status</p>
                {payment ? <PayBadge status={payment.paymentStatus} /> : <span className="opacity-40 text-xs">No payment</span>}
              </div>
            </div>
            {/* ── SECTION 2: Programs breakdown ── */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
                Programs &amp; Line Items
              </p>

              {programGroups.length === 0 && (
                <p className="text-sm opacity-40">No payment items found.</p>
              )}

              <div className="space-y-3">
                {programGroups.map((pg, idx) => {
                  // Unit price calculation: mirrors ReceiptService.cs logic
                  const unitPrice = pg.isPerPlayer
                    ? (pg.items[0]?.amount ?? 0)
                    : (pg.participantCount > 0
                        ? pg.subtotal / pg.participantCount
                        : pg.subtotal / Math.max(pg.items.length, 1));

                  return (
                    <div
                      key={`${pg.programName}-${idx}`}
                      style={{
                        border: "1px solid var(--color-table-border)",
                        backgroundColor: "var(--color-row-hover)",
                      }}
                    >
                      {/* Program header row */}
                      <div
                        className="flex items-center justify-between gap-3 px-4 py-3"
                        style={{ borderBottom: "1px solid var(--color-table-border)" }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <p className="font-semibold text-sm truncate">{pg.programName}</p>
                          {/* Fee type badge */}
                          <span
                            className="flex-shrink-0 text-xs px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: pg.isPerPlayer ? "var(--badge-open-bg)" : "var(--badge-soon-bg)",
                              color: pg.isPerPlayer ? "var(--badge-open-text)" : "var(--badge-soon-text)",
                            }}
                          >
                            {pg.isPerPlayer ? "Per head" : "Per entry"}
                          </span>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p
                            className="font-bold text-sm"
                            style={{ color: "var(--color-primary)" }}
                          >
                            SGD {pg.subtotal.toFixed(2)}
                          </p>
                          {pg.hasRefunds && (
                            <p className="text-xs" style={{ color: "var(--badge-open-text)" }}>
                              − SGD {pg.refundedAmount.toFixed(2)} refunded
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Program detail rows */}
                      <div className="px-4 py-3 grid gap-2 text-xs" style={{ gridTemplateColumns: "1fr auto auto" }}>
                        {/* Participant count */}
                        <div className="flex items-center gap-1.5 opacity-60">
                          <Users className="h-3.5 w-3.5" />
                          <span>
                            {pg.participantCount} participant{pg.participantCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {/* Qty × unit */}
                        <span className="opacity-50">
                          {pg.participantCount} × SGD {unitPrice.toFixed(2)}
                        </span>
                        {/* Item count (entries) */}
                        {!pg.isPerPlayer && pg.items.length > 1 && (
                          <span className="opacity-40">{pg.items.length} entries</span>
                        )}
                        {pg.isPerPlayer && (
                          <span className="opacity-40">{pg.items.length} items</span>
                        )}
                      </div>

                      {/* Per-item status breakdown — only when some items are refunded */}
                      {pg.items.some(i => i.itemStatus === "R") && (
                        <div
                          className="px-4 pb-3 space-y-1"
                          style={{ borderTop: "1px solid var(--color-table-border)", paddingTop: 10 }}
                        >
                          <p className="text-xs opacity-40 font-semibold uppercase tracking-wide mb-2">
                            Item status
                          </p>
                          {pg.items.map(item => {
                            const itemRefunds = refunds.filter(r => r.paymentItemId === item.id);
                            const successRefund = itemRefunds.find(r => r.refundStatus === "S");
                            return (
                              <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                                <span className="opacity-70 truncate">
                                  {item.playerName ?? item.description ?? item.programName}
                                </span>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {item.itemStatus === "R" && successRefund && (
                                    <span className="opacity-50">
                                      SGD {successRefund.refundAmount.toFixed(2)}
                                    </span>
                                  )}
                                  <span
                                    className="px-1.5 py-0.5 font-semibold"
                                    style={{
                                      backgroundColor: item.itemStatus === "R"
                                        ? "var(--badge-open-bg)" : item.itemStatus === "S"
                                        ? "transparent" : "var(--badge-soon-bg)",
                                      color: item.itemStatus === "R"
                                        ? "var(--badge-open-text)" : item.itemStatus === "S"
                                        ? "var(--color-primary)" : "var(--badge-soon-text)",
                                      border: item.itemStatus === "S"
                                        ? "1px solid var(--color-table-border)" : "none",
                                    }}
                                  >
                                    {item.itemStatus === "R" ? "Refunded"
                                      : item.itemStatus === "S" ? "Paid"
                                      : "Pending"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Programs total row */}
              {payment && (
                <div
                  className="px-4 py-3 mt-1 font-semibold text-sm"
                  style={{ borderTop: "2px solid var(--color-table-border)" }}
                >
                  <div className="flex items-center justify-between">
                    <span>Original Total</span>
                    <span style={{ color: "var(--color-primary)" }}>SGD {totalPaid.toFixed(2)}</span>
                  </div>
                  {totalRefunded > 0 && (
                    <>
                      <div className="flex items-center justify-between mt-2">
                        <span>Total Refunded</span>
                        <span style={{ color: "var(--badge-open-text)" }}>- SGD {totalRefunded.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: "1px solid var(--color-table-border)" }}>
                        <span>Net Total</span>
                        <span style={{ color: netAmount <= 0 ? "var(--badge-open-text)" : "var(--color-primary)" }}>
                          SGD {netAmount.toFixed(2)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Admin note */}
            {payment?.adminNote && (
              <div
                className="px-4 py-3 text-xs"
                style={{
                  backgroundColor: "var(--color-row-hover)",
                  border: "1px solid var(--color-table-border)",
                }}
              >
                <span className="opacity-50 font-semibold uppercase tracking-wide mr-2">Admin Note</span>
                {payment.adminNote}
              </div>
            )}

            {/* ── SECTION 3: Transaction Timeline ── */}
            {auditRows.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
                  Audit Trail
                </p>
                <table className="trs-table w-full" style={{ border: "1px solid var(--color-table-border)", tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>Date / Time</th>
                      <th style={{ width: 190 }}>Action</th>
                      <th style={{ width: 120 }}>Status</th>
                      <th style={{ width: 120 }}>Admin</th>
                      <th>Reason</th>
                      <th style={{ width: 130 }}>IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map(row => (
                      <tr key={row.id}>
                        <td className="font-mono text-xs opacity-60 whitespace-nowrap">
                          {formatDateTime(row.createdAt)}
                        </td>
                        <td className="text-sm font-medium">{row.action}</td>
                        <td className="text-xs">
                          <span className="font-mono">{row.oldStatus ?? "—"}</span>
                          <span className="opacity-40 mx-1">→</span>
                          <span className="font-mono">{row.newStatus ?? "—"}</span>
                        </td>
                        <td className="text-xs opacity-70">{row.performedBy ?? "—"}</td>
                        <td className="text-xs opacity-70">{row.reason ?? row.notes ?? "—"}</td>
                        <td className="font-mono text-xs opacity-50">{row.ipAddress ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {timeline.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
                  Transaction Timeline
                </p>
                <table className="trs-table w-full" style={{ border: "1px solid var(--color-table-border)", tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 176 }}>Date / Time</th>
                      <th style={{ width: 220 }}>Description</th>
                      <th style={{ width: 330 }}>Transaction ID</th>
                      <th style={{ width: 110, textAlign: "right" }}>Amount</th>
                      <th style={{ width: 120, whiteSpace: "normal", lineHeight: 1.25 }}>Payment Status</th>
                      <th style={{ width: 120, whiteSpace: "normal", lineHeight: 1.25 }}>Payment Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((entry, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs opacity-60 whitespace-nowrap">
                          {formatDateTime(entry.date)}
                        </td>
                        <td>
                          <p className="text-sm font-medium">{entry.label}</p>
                          {entry.description && (
                            <p className="text-xs opacity-50 mt-0.5">{entry.description}</p>
                          )}
                        </td>
                        <td className="font-mono text-xs opacity-60 whitespace-nowrap">
                          {entry.transactionId ?? entry.gatewayRef ?? "—"}
                        </td>
                        <td className="text-right font-semibold text-sm whitespace-nowrap">
                          {entry.type === "refund" && (
                            <span style={{ color: "var(--badge-open-text)" }}>
                              − SGD {entry.amount.toFixed(2)}
                            </span>
                          )}
                          {entry.type === "payment" && (
                            <span style={{ color: "var(--color-primary)" }}>
                              SGD {entry.amount.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td>
                          {entry.type === "payment"
                            ? <PayBadge status={entry.status as PaymentStatus} />
                            : <RefundStatusBadge status={entry.status} />}
                        </td>
                        <td className="text-xs font-medium">
                          {entry.paymentMethod ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>

        {/* ── Footer ── */}
        <DialogFooter
          className="px-7 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid var(--color-table-border)" }}
        >
          {/* Receipt button anchored left; Close anchored right via flex justify-between */}
          <div className="flex items-center justify-between w-full gap-4">
            <div title={!hasReceipt ? "Receipt not yet generated — payment must be confirmed first" : undefined}>
              <a
                href={hasReceipt ? receiptUrl : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!hasReceipt}
                onClick={e => { if (!hasReceipt) e.preventDefault(); }}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                style={{
                  border: "1px solid var(--color-table-border)",
                  backgroundColor: hasReceipt ? "var(--color-primary)" : "var(--color-row-hover)",
                  color: hasReceipt ? "white" : "var(--color-disabled-text)",
                  cursor: hasReceipt ? "pointer" : "not-allowed",
                  opacity: hasReceipt ? 1 : 0.6,
                  textDecoration: "none",
                }}
              >
                <Download className="h-4 w-4" />
                Download Receipt PDF
              </a>
            </div>
            <button onClick={onClose} className="btn-outline px-5 py-2.5 text-sm">
              Close
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small helper sub-components used inside PaymentLogModal ───────────────────

function MetaField({
  label, value, mono = false, bold = false,
}: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div>
      <p className="text-xs opacity-50 mb-0.5">{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""} ${bold ? "font-bold" : ""}`}>{value}</p>
    </div>
  );
}

function GatewayRef({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="opacity-40 font-semibold uppercase tracking-wide mr-1">{label}</span>
      <span className="font-mono opacity-60 truncate block" title={value}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminRegistrations() {
  const [urlParams] = useSearchParams();
  const navigate    = useNavigate();

  // ── Filters ──────────────────────────────────────────────────────────────

  const [filterEvent,   setFilterEvent]   = useState(urlParams.get("event")     || "");
  const [filterProgram, setFilterProgram] = useState(urlParams.get("program")   || "");
  const [filterReg,     setFilterReg]     = useState(urlParams.get("regStatus") || "");  
  const [filterPay,     setFilterPay]     = useState(urlParams.get("payStatus") || "");  
  const [filterSearchInput, setFilterSearchInput] = useState("");
  const [filterSearch,  setFilterSearch]  = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  // ── Remote state ──────────────────────────────────────────────────────────
  const [events,      setEvents]      = useState<TournamentEvent[]>([]);
  const [regs,        setRegs]        = useState<Registration[]>([]);
  const [regTotal,    setRegTotal]    = useState(0);
  const [regTotalPgs, setRegTotalPgs] = useState(1);
  const [refundsByReg, setRefundsByReg] = useState<Record<string, Refund[]>>({});
  const [loadingRegs, setLoadingRegs] = useState(true);
  const [apiError,    setApiError]    = useState("");
  const [confirmRegModal,  setConfirmRegModal]  = useState<Registration | null>(null);
  const [confirmRegNote,   setConfirmRegNote]   = useState("");
  const [savingConfirmReg, setSavingConfirmReg] = useState(false);

  useEffect(() => {
    apiGetEvents().then(r => { if (r.data) setEvents(r.data); });
  }, []);

  useEffect(() => {
    setLoadingRegs(true);
    apiGetRegistrations(
      {
        eventId:   filterEvent   || undefined,
        programId: filterProgram || undefined,
        regStatus: filterReg     || undefined,
        payStatus: filterPay     || undefined,
        search:    filterSearch  || undefined,
      },
      { page, pageSize: perPage },
    ).then(r => {
      if (r.data) {
        setRegs(r.data.items);
        setRegTotal(r.data.total);
        setRegTotalPgs(r.data.totalPages);
      }
    }).finally(() => setLoadingRegs(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEvent, filterProgram, filterReg, filterPay, filterSearch, page, perPage]);

  useEffect(() => {
    let active = true;
    const uniqueRegs = Array.from(new Map(regs.map(reg => [reg.id, reg])).values());
    if (uniqueRegs.length === 0) {
      setRefundsByReg({});
      return () => { active = false; };
    }
    Promise.all(
      uniqueRegs.map(async (reg) => {
        const result = await apiGetRefunds(reg.id);
        return [reg.id, result.data ?? []] as const;
      }),
    ).then((entries) => {
      if (!active) return;
      setRefundsByReg(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [regs]);

  const programsForEvent = useMemo(() =>
    events.find(e => e.id === filterEvent)?.programs ?? [], [events, filterEvent]);

  const sorted = useMemo(() => [...regs].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [regs]);
  const paged  = sorted;

  // ── Action dropdown ───────────────────────────────────────────────────────
  const [openAction, setOpenAction] = useState<{ reg: Registration; anchorEl: HTMLElement } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilterSearch(filterSearchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filterSearchInput]);

  // ── Modals ────────────────────────────────────────────────────────────────
  const [markPaidModal,   setMarkPaidModal]   = useState<Registration | null>(null);
  const [paymentLogModal, setPaymentLogModal] = useState<Registration | null>(null);
  const [cancelModal,     setCancelModal]     = useState<Registration | null>(null);
  const [refundModal,     setRefundModal]     = useState<Registration | null>(null);
  const [markPaidMethod,  setMarkPaidMethod]  = useState<PaymentMethod>("PayNow");
  const [markPaidRemark,  setMarkPaidRemark]  = useState("");
  const [cancelReason,    setCancelReason]    = useState("");
  const [refundSel,       setRefundSel]       = useState<Record<string, { checked: boolean; reason: string }>>({});
  const [savingMarkPaid,  setSavingMarkPaid]  = useState(false);
  const [savingCancel,    setSavingCancel]    = useState(false);
  const [savingRefund,    setSavingRefund]    = useState(false);

  // ── Mutation helpers ──────────────────────────────────────────────────────
  const handleMarkPaid = async () => {
    if (!markPaidModal || !markPaidRemark.trim()) return;
    setSavingMarkPaid(true);
    try {
      const payR = await apiUpdatePayment(markPaidModal.id, {
        paymentStatus: "S",
        method: markPaidMethod,
        adminNote: markPaidRemark,
      });
      if (payR.error) { setApiError(payR.error.message); return; }
      if (payR.data) {
        setRegs(prev => prev.map(reg => reg.id === payR.data!.id ? payR.data! : reg));
      }
      setMarkPaidModal(null);
      setMarkPaidRemark("");
      setMarkPaidMethod("PayNow");
    } finally {
      setSavingMarkPaid(false);
    }
  };

  const handleCancel = async (refundMode: CancellationRefundMode) => {
    if (!cancelModal || !cancelReason.trim()) return;
    setSavingCancel(true);
    try {
      const cancelR = await apiCancelRegistration(
        cancelModal.id,
        cancelReason,
        refundMode,
      );
      if (cancelR.error) {
        setApiError(cancelR.error.message);
        return;
      }
      if (cancelR.data?.registration) {
        setRegs(prev => prev.map(reg => reg.id === cancelR.data!.registration.id ? cancelR.data!.registration : reg));
      }
      const refR = await apiGetRefunds(cancelModal.id);
      if (refR.data) {
        setRefundsByReg(prev => ({ ...prev, [cancelModal.id]: refR.data! }));
      }
      if ((cancelR.data?.errors ?? []).length > 0) {
        setApiError(`Cancellation is pending; some refunds failed: ${cancelR.data!.errors.join(" | ")}`);
        return;
      }
      setCancelModal(null);
      setCancelReason("");
    } finally {
      setSavingCancel(false);
    }
  };

  // Refund: check if removing a per-player item would drop group below minPlayers
  const getGroupMinPlayersWarning = (reg: Registration, itemId: string): string | null => {
    const payment = getPayment(reg);
    const item = payment?.items.find(i => i.id === itemId);
    if (!item?.participantId) return null;
    const group = reg.groups.find(g => g.id === item.participantGroupId);
    if (!group) return null;
    const eventProgram = events.flatMap(e => e.programs).find(p => p.id === group.programId);
    if (!eventProgram) return null;
    const activeItems = (payment?.items ?? []).filter(
      i => i.participantGroupId === group.id && i.participantId && i.itemStatus !== "R" && i.id !== itemId
    );
    const remainingPlayers = activeItems.length;
    if (remainingPlayers < eventProgram.minPlayers) {
      return `Removing this participant leaves ${remainingPlayers} — below the minimum of ${eventProgram.minPlayers}. Cancel the entire entry instead.`;
    }
    return null;
  };

  const handleRefund = async () => {
    if (!refundModal) return;
    const payment = getPayment(refundModal);
    if (!payment) { setApiError("This registration has no payment record to refund."); return; }
    setSavingRefund(true);
    try {
      const refundErrors: string[] = [];
      for (const [itemId, sel] of Object.entries(refundSel)) {
        if (!sel.checked || !sel.reason.trim()) continue;
        if (getGroupMinPlayersWarning(refundModal, itemId)) continue;
        const item = payment.items.find(i => i.id === itemId);
        if (!item) continue;
        const refundResult = await apiInitiateRefund(refundModal.id, itemId, item.amount, sel.reason, "admin");
        if (refundResult.error) refundErrors.push(`${item.programName}: ${refundResult.error.message}`);
      }
      const [regR, refR] = await Promise.all([
        apiGetRegistration(refundModal.id),
        apiGetRefunds(refundModal.id),
      ]);
      if (regR.data) {
        setRegs(prev => prev.map(r => r.id === refundModal.id ? regR.data! : r));
      }
      if (refR.data) {
        setRefundsByReg(prev => ({ ...prev, [refundModal.id]: refR.data! }));
      }
      if (refundErrors.length > 0) {
        setApiError(`Some refunds failed: ${refundErrors.join(" | ")}`);
        return;
      }
      setRefundModal(null);
      setRefundSel({});
    } finally {
      setSavingRefund(false);
    }
  };

  const handleConfirmReg = async () => {
    if (!confirmRegModal) return;
    setSavingConfirmReg(true);
    try {
      const r = await apiConfirmRegistration(confirmRegModal.id, {
        paymentStatus: "S",   
        adminNote: confirmRegNote.trim() || "Admin confirmed — Payment verified",
      });
      if (r.error) { setApiError(r.error.message); return; }
      if (r.data) {
        setRegs(prev => prev.map(reg => reg.id === r.data!.id ? r.data! : reg));
      }
      setConfirmRegModal(null);
      setConfirmRegNote("");
    } finally {
      setSavingConfirmReg(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="sticky-header">
        <div className="admin-page-title"><h1>Registrations &amp; Payments</h1></div>
        {apiError && (
          <div className="mb-4 px-4 py-3 text-sm font-medium flex items-center justify-between"
            style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)", border: "1px solid var(--badge-closed-text)" }}>
            <span>{apiError}</span>
            <button onClick={() => setApiError("")} className="ml-4 opacity-60 hover:opacity-100 text-xs font-bold">✕</button>
          </div>
        )}
      </div>

      {/* ══════════ REGISTRATIONS ══════════ */}
      <>
        {/* Filters */}
        <div className="p-4 mb-5" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
          <div className="flex flex-wrap items-end gap-3">
            <FG label="Search">
              <input className="field-input w-52" placeholder="Name, ID, club…"
                value={filterSearchInput} onChange={e => setFilterSearchInput(e.target.value)} />
            </FG>
            <FG label="Event">
              <select className="field-input w-56" value={filterEvent}
                onChange={e => { setFilterEvent(e.target.value); setFilterProgram(""); setPage(1); }}>
                <option value="">All Events</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </FG>
            <FG label="Program">
              <select className="field-input w-44" value={filterProgram} disabled={!filterEvent}
                onChange={e => { setFilterProgram(e.target.value); setPage(1); }}>
                <option value="">All Programs</option>
                {programsForEvent.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FG>
            <FG label="Reg. Status">
              <select className="field-input w-36" value={filterReg}
                onChange={e => { setFilterReg(e.target.value); setPage(1); }}>
                <option value="">All</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Pending">Pending</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </FG>
            <FG label="Payment">
              <select className="field-input w-40" value={filterPay}
                onChange={e => { setFilterPay(e.target.value); setPage(1); }}>
                <option value="">All</option>
                {(Object.entries(PAYMENT_STATUS_LABEL) as [PaymentStatus, string][]).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </FG>
          </div>
        </div>

        {/* Table */}
        <div style={{ border: "1px solid var(--color-table-border)" }}>
          <div className="hidden md:block overflow-x-auto">
          <table className="trs-table">
            <thead>
              <tr>
                <th>Reg ID</th>
                <th>Contact</th>
                <th>Event</th>
                <th>Programs</th>
                <th>Reg. Status</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Submitted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loadingRegs && (
                <tr><td colSpan={10} className="text-center py-6"><LoadingSpinner size="sm" label="Loading registrations…" /></td></tr>
              )}
              {!loadingRegs && paged.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 opacity-40">No registrations found.</td></tr>
              )}
              {paged.map(reg => {
                const payment      = getPayment(reg);
                const programInfo  = programEntrySummary(reg.groups);
                const regRefunds   = refundsByReg[reg.id] ?? [];
                const refunded     = calcRefunded(regRefunds, payment?.items ?? []);

                return (
                  <React.Fragment key={reg.id}>
                    <tr style={reg.regStatus === "Pending" || payment?.paymentStatus === "P"
                      ? { borderLeft: "3px solid var(--badge-soon-text)" } : undefined}>
                      <td className="font-mono text-xs">{reg.id}</td>
                      <td>
                        <p className="font-semibold text-sm">{reg.contactName}</p>
                        <p className="text-xs opacity-50">{reg.contactEmail}</p>
                      </td>
                      <td className="text-sm max-w-40">
                        <p className="truncate">{reg.eventName}</p>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 opacity-30" />
                          <span className="text-sm">{programInfo.programCount} program{programInfo.programCount !== 1 ? "s" : ""}</span>
                        </div>
                        <p className="text-xs opacity-50 mt-0.5">
                          {programInfo.text}
                        </p>
                      </td>
                      <td><RegBadge status={reg.regStatus} /></td>
                      <td>{payment ? <PayBadge status={payment.paymentStatus} /> : <span className="opacity-40">No payment</span>}</td>
                      <td className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
                        ${payment ? totalFee(reg).toFixed(2) : "0.00"}
                        {refunded > 0 && (
                          <span className="block text-xs font-normal" style={{ color: "var(--badge-open-text)" }}>
                            −${refunded.toFixed(2)} refunded
                          </span>
                        )}
                      </td>
                      <td className="text-xs opacity-60">
                        {new Date(reg.submittedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td>
                        <div className="relative">
                          <button
                            onClick={(e) =>
                              setOpenAction(openAction?.reg.id === reg.id ? null : { reg, anchorEl: e.currentTarget })
                            }
                            className="p-2 hover:opacity-70" style={{ color: "var(--color-primary)" }}>
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="md:hidden divide-y" style={{ borderColor: "var(--color-table-border)" }}>
            {loadingRegs && (
              <div className="text-center py-6">
                <LoadingSpinner size="sm" label="Loading registrations..." />
              </div>
            )}
            {!loadingRegs && paged.length === 0 && (
              <div className="text-center py-10 opacity-40 text-sm">No registrations found.</div>
            )}
            {paged.map(reg => {
              const payment      = getPayment(reg);
              const programInfo  = programEntrySummary(reg.groups);
              const regRefunds   = refundsByReg[reg.id] ?? [];
              const refunded     = calcRefunded(regRefunds, payment?.items ?? []);

              return (
                <div key={reg.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs opacity-50">Reg {reg.id}</p>
                      <p className="font-semibold text-sm truncate">{reg.contactName}</p>
                      <p className="text-xs opacity-50 truncate">{reg.contactEmail}</p>
                    </div>
                    <button
                      onClick={(e) =>
                        setOpenAction(openAction?.reg.id === reg.id ? null : { reg, anchorEl: e.currentTarget })
                      }
                      className="p-2 -mr-2 hover:opacity-70"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-3 text-sm font-medium truncate">{reg.eventName}</p>
                  <div className="mt-2 flex items-start gap-1.5">
                    <Users className="h-3.5 w-3.5 opacity-30 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm">{programInfo.programCount} program{programInfo.programCount !== 1 ? "s" : ""}</p>
                      <p className="text-xs opacity-50">{programInfo.text}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <RegBadge status={reg.regStatus} />
                    {payment ? <PayBadge status={payment.paymentStatus} /> : <span className="text-xs opacity-40">No payment</span>}
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div className="text-xs opacity-60">
                      Submitted
                      <p>{new Date(reg.submittedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}</p>
                    </div>
                    <p className="text-right font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
                      ${payment ? totalFee(reg).toFixed(2) : "0.00"}
                      {refunded > 0 && (
                        <span className="block text-xs font-normal" style={{ color: "var(--badge-open-text)" }}>
                          -${refunded.toFixed(2)} refunded
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={page} totalPages={regTotalPgs} perPage={perPage} total={regTotal}
            setPage={setPage} setPerPage={n => { setPerPage(n); setPage(1); }} />
        </div>
      </>

      {/* ══════════ ACTION DROPDOWN ══════════ */}
      <ActionDropdownPortal
        open={!!openAction}
        anchorEl={openAction?.anchorEl ?? null}
        onClose={() => setOpenAction(null)}
      >
        {openAction && (
          <>
            <button
              disabled={!(["P", "PC"].includes(getPayment(openAction.reg)?.paymentStatus ?? "") && openAction.reg.regStatus !== "Cancelled")}
              onClick={() => { setMarkPaidModal(openAction.reg); setOpenAction(null); }}
            >
              <CheckCircle className="h-4 w-4" /> Mark as Paid
            </button>
            <button
              disabled={!(
                openAction.reg.regStatus === "Pending" &&
                getPayment(openAction.reg)?.paymentStatus === "S"
              )}
              onClick={() => { setConfirmRegModal(openAction.reg); setOpenAction(null); }}
            >
              <CheckCircle className="h-4 w-4" /> Confirm Registration
            </button>
            <button
              disabled={!((getPayment(openAction.reg)?.items ?? []).some(item => item.itemStatus === "S") && openAction.reg.regStatus !== "Cancelled")}
              onClick={() => { setRefundSel({}); setRefundModal(openAction.reg); setOpenAction(null); }}
            >
              <RefreshCw className="h-4 w-4" /> Refund
            </button>
{/* Payment Log disabled when there is no payment record at all */}
            {(() => {
              const pay = getPayment(openAction.reg);
              const hasLog = !!pay;
              return (
                <button
                  disabled={!hasLog}
                  onClick={() => { setPaymentLogModal(openAction.reg); setOpenAction(null); }}
                  style={{ opacity: hasLog ? 1 : 0.35, cursor: hasLog ? "pointer" : "not-allowed" }}
                  title={!hasLog ? "No payment record for this registration" : undefined}
                >
                  <Receipt className="h-4 w-4" /> Payment Log
                </button>
              );
            })()}
            <button onClick={() => {
              navigate(`/admin/registrations/${openAction.reg.id}/participants`);
              setOpenAction(null);
            }}>
              <Users className="h-4 w-4" /> Participant List
            </button>


            <button
              disabled={openAction.reg.regStatus === "Cancelled"}
              onClick={() => { setCancelModal(openAction.reg); setOpenAction(null); }}
            >
              <XCircle className="h-4 w-4" /> Cancel
            </button>
          </>
        )}
      </ActionDropdownPortal>

      {/* ══════════ MODALS ══════════ */}

      {/* Mark as Paid */}
      <Dialog open={!!markPaidModal} onOpenChange={v => { if (!v) { setMarkPaidModal(null); setMarkPaidRemark(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Mark as Paid</DialogTitle>
            {markPaidModal && (
              <p className="text-xs opacity-50 mt-1">
                {markPaidModal.id} · {markPaidModal.groups.map(g => g.programName).join(", ")} · Total: ${getPayment(markPaidModal) ? totalFee(markPaidModal).toFixed(2) : "0.00"}
              </p>
            )}
          </DialogHeader>
          <div className="p-7 space-y-4">
            <FG label="Payment Method *">
              <select className="field-input" value={markPaidMethod}
                onChange={e => setMarkPaidMethod(e.target.value as PaymentMethod)}>
                <option value="CreditCard">Credit Card</option>
                <option value="PayNow">PayNow</option>
                <option value="Cash">Cash</option>
                <option value="BankTransfer">Bank Transfer</option>
                <option value="Others">Others</option>
              </select>
            </FG>
            <FG label="Remark *">
              <textarea className="field-input" rows={2} value={markPaidRemark}
                onChange={e => setMarkPaidRemark(e.target.value)}
                placeholder="e.g. Cash collected at counter on 12 Mar" />
            </FG>
          </div>
          <DialogFooter className="p-7 pt-0">
            <button onClick={() => setMarkPaidModal(null)} className="btn-outline px-5 py-2.5 text-sm">Cancel</button>
            <button onClick={handleMarkPaid} disabled={!markPaidRemark.trim() || savingMarkPaid}
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40">
              {savingMarkPaid ? "Saving..." : "Confirm Payment"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

  
      <Dialog open={!!confirmRegModal} onOpenChange={v => { if (!v) { setConfirmRegModal(null); setConfirmRegNote(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Confirm Registration</DialogTitle>
            {confirmRegModal && (
              <p className="text-xs opacity-50 mt-1">
                {confirmRegModal.id} · {confirmRegModal.contactName} · ${getPayment(confirmRegModal) ? totalFee(confirmRegModal).toFixed(2) : "0.00"}
              </p>
            )}
          </DialogHeader>
          <div className="p-7 space-y-4">
            <div className="px-3 py-2 text-xs"
              style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
              Stripe payment is confirmed (status S). Confirming this registration will set
              RegStatus to Confirmed and send the confirmation email.
            </div>
            <FG label="Admin note (optional)">
              <input
                className="field-input"
                value={confirmRegNote}
                onChange={e => setConfirmRegNote(e.target.value)}
              />
            </FG>
          </div>
          <DialogFooter className="p-7 pt-0">
            <button onClick={() => setConfirmRegModal(null)} className="btn-outline px-5 py-2.5 text-sm">Cancel</button>
            <button
              onClick={handleConfirmReg}
              disabled={savingConfirmReg}
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {savingConfirmReg ? "Confirming..." : "Confirm Registration"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={!!cancelModal} onOpenChange={v => { if (!v) { setCancelModal(null); setCancelReason(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Cancel Registration</DialogTitle>
          </DialogHeader>
          <div className="p-7 space-y-4">
            {(() => {
              const payment = getPayment(cancelModal as Registration);
              const refunds = cancelModal ? (refundsByReg[cancelModal.id] ?? []) : [];
              const count = refundableItems(payment, refunds).length;
              return count > 0 ? (
                <div className="p-3 text-sm" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
                  This registration has {count} paid item{count !== 1 ? "s" : ""} eligible for refund. Use "Cancel + Refund" to refund them.
                </div>
              ) : null;
            })()}
            <div className="p-3 text-xs leading-relaxed" style={{ backgroundColor: "var(--color-row-hover)", color: "var(--color-body-text)" }}>
              Per-entry doubles/team player withdrawal is handled as a roster edit or participant replacement, not a player cancellation/refund.
            </div>
            <div className="p-3 text-xs leading-relaxed" style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
              If a fixture has already been generated for the affected program, cancellation cannot be completed. Remove the fixture first, then try again.
            </div>
            <FG label="Reason *">
              <textarea className="field-input" rows={3} value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Enter reason for cancellation…" />
            </FG>
          </div>
          <DialogFooter className="p-7 pt-0">
            <button onClick={() => { setCancelModal(null); setCancelReason(""); }} className="btn-outline px-5 py-2.5 text-sm">Close</button>
            <button onClick={() => handleCancel("none")} disabled={!cancelReason.trim() || savingCancel}
              className="px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--badge-closed-text)", color: "white" }}>
              {savingCancel ? "Cancelling..." : "Cancel Only"}
            </button>
            {(() => {
              const payment = getPayment(cancelModal as Registration);
              const refunds = cancelModal ? (refundsByReg[cancelModal.id] ?? []) : [];
              const canRefund = refundableItems(payment, refunds).length > 0;
              return canRefund ? (
                <button onClick={() => handleCancel("refundPaidItems")} disabled={!cancelReason.trim() || savingCancel}
                  className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40">
                  {savingCancel ? "Processing..." : "Cancel + Refund"}
                </button>
              ) : null;
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund */}
      <Dialog open={!!refundModal} onOpenChange={v => { if (!v) { setRefundModal(null); setRefundSel({}); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Process Refund</DialogTitle>
            {refundModal && <p className="text-xs opacity-50 mt-1">{refundModal.id} · {refundModal.contactName}</p>}
          </DialogHeader>
          <div className="p-7 space-y-4">
            {(getPayment(refundModal as Registration)?.items ?? []).map(item => {
              const alreadyRefunded = item.itemStatus === "R";
              const existingRefund  = (refundModal ? (refundsByReg[refundModal.id] ?? []) : [])
                .find(r => r.paymentItemId === item.id && r.refundStatus === "S");
              const warning = refundModal && refundSel[item.id]?.checked
                ? getGroupMinPlayersWarning(refundModal, item.id) : null;
              const isPerPlayer = !!item.participantId;
              return (
                <div key={item.id} className="p-4 space-y-3"
                  style={{ border: `1px solid ${warning ? "var(--badge-closed-text)" : "var(--color-table-border)"}`, opacity: alreadyRefunded ? 0.5 : 1 }}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <Switch disabled={alreadyRefunded}
                      checked={refundSel[item.id]?.checked ?? false}
                      onCheckedChange={v => setRefundSel(p => ({ ...p, [item.id]: { checked: v, reason: p[item.id]?.reason ?? "" } }))} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium">{item.programName}</span>
                          {isPerPlayer && item.playerName && (
                            <span className="text-xs opacity-60 ml-2">— {item.playerName}</span>
                          )}
                          {!isPerPlayer && (
                            <span className="text-xs opacity-40 ml-2">(per entry)</span>
                          )}
                        </div>
                        <span className="font-bold text-sm ml-3" style={{ color: "var(--color-primary)" }}>
                          ${item.amount.toFixed(2)}
                        </span>
                      </div>
                      {alreadyRefunded && existingRefund && (
                        <p className="text-xs mt-0.5 opacity-60">
                          Already refunded ${existingRefund.refundAmount.toFixed(2)} on {formatDateTime(existingRefund.createdAt)}
                        </p>
                      )}
                    </div>
                  </label>
                  {warning && (
                    <div className="flex items-start gap-2 p-3 text-xs font-medium"
                      style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
                      ⚠ {warning}
                    </div>
                  )}
                  {refundSel[item.id]?.checked && !warning && (
                    <input className="field-input" placeholder="Reason *"
                      value={refundSel[item.id]?.reason ?? ""}
                      onChange={e => setRefundSel(p => ({ ...p, [item.id]: { ...p[item.id], reason: e.target.value } }))} />
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter className="p-7 pt-0">
            <button onClick={() => setRefundModal(null)} className="btn-outline px-5 py-2.5 text-sm">Close</button>
            <button onClick={handleRefund}
              disabled={!Object.entries(refundSel).some(([id, s]) => {
                if (!s.checked || !s.reason.trim()) return false;
                if (refundModal && getGroupMinPlayersWarning(refundModal, id)) return false;
                return true;
              }) || savingRefund}
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40">
              {savingRefund ? "Processing..." : "Process Refund"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Log — full-width redesigned panel */}
      {paymentLogModal && (
        <PaymentLogModal
          reg={paymentLogModal}
          refunds={refundsByReg[paymentLogModal.id] ?? []}
          onClose={() => setPaymentLogModal(null)}
        />
      )}
    </div>
  );
}
