/**
 * Registrations.tsx - Registration & Payment Management
 *
 * Primary unit: Registration (one row = one form submission).
 * Each registration can cover multiple programs (multiple ParticipantGroups).
 * One payment receipt per registration covers all programs in that submission.
 *
 * Payment Log modal - redesigned:
 *  - Full-width panel (max-w-4xl) with two-column layout
 *  - Programs grouped as cards (Registration -> Program -> Participant count)
 *  - Per-entry vs per-player clearly labelled with fee badge
 *  - Always shows participant count (never a long name list)
 *  - Refund timeline shows ALL (P/S/F) in chronological order
 *  - Receipt download grayed out (with tooltip) when no receipt yet
 *  - Single source: both admin and user hit GET /api/registrations/:id/receipt
 */

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  CreditCard, CheckCircle, XCircle, RefreshCw,
  Receipt, MoreVertical, Users, ExternalLink,
  Clock, AlertCircle, Download, Loader2,
} from "lucide-react";
import type { TournamentEvent } from "@/types/config";
import { isTeamProgram } from "@/types/config";
import type { Registration, ParticipantGroup, Payment, PaymentItem, Refund, PaymentMethod, PaymentStatus, PaymentAuditEntry, RefundMethod, RefundSource, RegStatus, ItemStatus, ParticipantStatus, GroupStatus } from "@/types/registration";
import { totalFee, PAYMENT_STATUS_LABEL, PAYMENT_METHOD_LABEL, REG_STATUS_LABEL, ITEM_STATUS_LABEL, PARTICIPANT_STATUS_LABEL } from "@/types/registration";
import {
  apiGetEvents, apiGetRegistration, apiGetRegistrations,
  apiUpdatePayment,
  apiGetRefunds, apiGetPaymentAudit, apiCancelRegistration, apiCancelRegistrationGroup,
  apiCancelRegistrationParticipant, apiConfirmRegistration, apiInitiateRefunds,
  apiSendCancellationNotification, assetUrl,
} from "@/lib/api";
import type { CancellationRefundMode } from "@/lib/api/registrationsApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/TableControls";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import { Switch } from "@/components/ui/switch";
import { useLiveConfig } from "@/contexts/LiveConfigContext";
import { formatConfiguredDateTime } from "@/lib/dateTime";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import ActionDropdownPortal from "@/components/ui/ActionDropdownPortal";

//  Types

type RefundCancelAction = "refundOnly" | "cancelWithoutRefund" | "cancelWithRefund";
type RefundCancelScope = "whole" | "selected";

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

//  Badges

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
  const label = REG_STATUS_LABEL[status as RegStatus] ?? status;
  const m: Record<string, [string, string]> = {
    C:  ["var(--badge-open-bg)",   "var(--badge-open-text)"],
    P:  ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    CP: ["var(--badge-soon-bg)",   "var(--badge-soon-text)"],
    RF: ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
    X:  ["var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [bg, text] = m[status] ?? m.P;
  return <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: bg, color: text }}>{label}</span>;
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
  return <div><label className="block text-xs font-semibold mb-1.5">{label}</label>{children}</div>;
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
  if (!value) return "-";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

//  Helpers

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
    if (item.itemStatus !== "S" && item.itemStatus !== "X") return false;
    const refunded = refunds
      .filter(r => r.paymentItemId === item.id && r.refundStatus === "S")
      .reduce((sum, r) => sum + r.refundAmount, 0);
    const pending = refunds.some(r => r.paymentItemId === item.id && r.refundStatus === "P");
  return !pending && item.amount - refunded > 0;
  });
}

const EXTERNAL_REFUND_METHODS: Array<{ value: RefundMethod; label: string }> = [
  { value: "GatewayDashboard", label: "Payment gateway dashboard" },
  { value: "PayNow", label: "PayNow" },
  { value: "BankTransfer", label: "Bank transfer" },
  { value: "Cash", label: "Cash" },
  { value: "Other", label: "Other" },
];

function requiresRefundReference(method: RefundMethod): boolean {
  return method !== "Cash";
}

//  Payment Log helpers

interface PaymentLineRow {
  id:             string;
  programName:    string;
  typeLabel:      string;
  regStatus:      string;
  paymentStatus:  string;
  entryLabel:     string;
  remark?:        string;
  amount:         number;
  refundedAmount: number;
  netAmount:      number;
  refundRefs:     string[];
}

function itemStatusLabel(status: string): string {
  return ITEM_STATUS_LABEL[status as ItemStatus] ?? status;
}

function groupStatusLabel(status?: GroupStatus): string {
  if (status === "X") return "Cancelled";
  if (status === "C") return "Confirmed";
  if (status === "P") return "Pending";
  return status ?? "-";
}

function participantStatusLabel(status?: ParticipantStatus): string {
  if (status === "A") return "Confirmed";
  return status ? PARTICIPANT_STATUS_LABEL[status] : "-";
}

function rowPaymentStatusLabel(paymentStatus: PaymentStatus, itemStatus: ItemStatus): string {
  if (itemStatus === "R") return "Refunded";
  if (itemStatus === "X") return "Cancelled";
  if (paymentStatus === "W" || paymentStatus === "PC" || paymentStatus === "P" || paymentStatus === "F") {
    return PAYMENT_STATUS_LABEL[paymentStatus];
  }
  return itemStatusLabel(itemStatus);
}

function buildPaymentLineRows(
  payment:  Payment,
  groups:   ParticipantGroup[],
  refunds:  Refund[],
): PaymentLineRow[] {
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const rows: PaymentLineRow[] = [];

  function describeItem(item: PaymentItem) {
    const group = groupsById.get(item.participantGroupId);
    const participant = group?.participants.find(p => p.id === item.participantId);
    const isPerPlayer = !!item.participantId;
    const participantCount = group?.participants.length ?? 1;
    const teamOrClub = group?.clubDisplay?.trim();

    let entryLabel = item.playerName ?? participant?.fullName ?? group?.namesDisplay ?? item.description ?? item.programName;
    if (isPerPlayer && participantCount > 2 && teamOrClub) {
      entryLabel = `${teamOrClub} - ${item.playerName ?? participant?.fullName ?? "Participant"}`;
    } else if (!isPerPlayer && participantCount > 2) {
      entryLabel = `${teamOrClub || group?.namesDisplay || item.description || item.programName} (${participantCount} participants)`;
    }

    return {
      isPerPlayer,
      entryLabel,
      regStatus: isPerPlayer
        ? participantStatusLabel(participant?.participantStatus)
        : groupStatusLabel(group?.groupStatus),
    };
  }

  for (const item of payment.items) {
    const description = describeItem(item);
    const successfulRefunds = refunds.filter(r => r.paymentItemId === item.id && r.refundStatus === "S");
    const refundedAmount = successfulRefunds.reduce((sum, refund) => sum + refund.refundAmount, 0);
    const refundReasons = successfulRefunds
      .map(refund => refund.refundReason?.trim())
      .filter((reason): reason is string => !!reason);
    const refundRefs = successfulRefunds
      .map(refund => refund.gatewayRefundId?.trim() || refund.id)
      .filter(Boolean);
    rows.push({
      id: `item-${item.id}`,
      programName: item.programName,
      typeLabel: description.isPerPlayer ? "Per head" : "Per entry",
      regStatus: description.regStatus,
      paymentStatus: rowPaymentStatusLabel(payment.paymentStatus, item.itemStatus as ItemStatus),
      entryLabel: description.entryLabel,
      remark: refundReasons.length ? Array.from(new Set(refundReasons)).join("; ") : undefined,
      amount: item.amount,
      refundedAmount,
      netAmount: Math.max(0, item.amount - refundedAmount),
      refundRefs: Array.from(new Set(refundRefs)),
    });
  }

  return rows;
}

/**
 * Builds a flat chronological transaction timeline:
 * 1. The original payment event
 * 2. All refunds (all: P/S/F) sorted by createdAt
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

  // Refund entries - all statuses
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

//  Payment Log Modal

interface PaymentLogModalProps {
  reg:      Registration;
  refunds:  Refund[];
  onClose:  () => void;
}

function PaymentLogModal({ reg, refunds, onClose }: PaymentLogModalProps) {
  const { cfg } = useLiveConfig();
  const payment = getPayment(reg);
  const [auditRows, setAuditRows] = useState<PaymentAuditEntry[]>([]);
  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
  const receiptUrl = `${API_BASE}/api/registrations/${reg.id}/receipt`;
  const detailsPdfUrl = `${API_BASE}/api/registrations/${reg.id}/details-pdf`;
  const hasReceipt = !!payment?.receiptNo;

  const paymentLineRows = payment
    ? buildPaymentLineRows(payment, reg.groups, refunds)
    : [];
  const timeline = payment ? buildTimeline(payment, refunds) : [];
  const totalPaid = payment?.amount ?? 0;
  const totalRefunded = refunds
    .filter(r => r.refundStatus === "S")
    .reduce((s, r) => s + r.refundAmount, 0);
  const netAmount = totalPaid - totalRefunded;
  const formatDateTime = useCallback((value?: string | null) =>
    formatConfiguredDateTime(value, cfg.displayTimeZone, cfg.displayDateTimeFormat),
  [cfg.displayTimeZone, cfg.displayDateTimeFormat]);

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
  {/*  Header  */}
        <DialogHeader
          className="px-7 py-5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--color-table-border)" }}
        >
          <div>
            <DialogTitle className="font-bold text-lg">
              Payment Log - Registration {reg.id}
            </DialogTitle>
            <p className="text-xs opacity-50 mt-1">
              {reg.contactName} - {reg.eventName}
            </p>
          </div>
        </DialogHeader>

  {/*  Scrollable body  */}
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
              <MetaField label="Payer Contact" value={reg.contactPhone || "-"} />
              <MetaField label="Payment Method" value={payment?.method ? (PAYMENT_METHOD_LABEL[payment.method] ?? payment.method) : "-"} />
              <div>
                <p className="text-xs opacity-50 mb-1">Payment Status</p>
                {payment ? <PayBadge status={payment.paymentStatus} /> : <span className="opacity-40 text-xs">No payment</span>}
              </div>
            </div>
  {/*  SECTION 2: Programs breakdown  */}
            <div>
              <p className="text-xs font-bold uppercase tracking-wide opacity-50 mb-3">
                Programs &amp; Line Items
              </p>

              {paymentLineRows.length === 0 && (
                <p className="text-sm opacity-40">No payment items found.</p>
              )}

              {paymentLineRows.length > 0 && (
                <div className="space-y-3">
                  {paymentLineRows.map(row => {
                    const hasRefund = row.refundedAmount > 0;
                    const regBadgeStyle = {
                      backgroundColor: row.regStatus === "Cancelled"
                        ? "var(--badge-open-bg)"
                        : row.regStatus === "Confirmed" || row.regStatus === "Active"
                        ? "var(--color-row-hover)"
                        : "var(--badge-soon-bg)",
                      color: row.regStatus === "Cancelled"
                        ? "var(--badge-open-text)"
                        : row.regStatus === "Confirmed" || row.regStatus === "Active"
                        ? "var(--color-primary)"
                        : "var(--badge-soon-text)",
                    };
                    const payBadgeStyle = {
                      backgroundColor: row.paymentStatus === "Refunded"
                        ? "var(--badge-open-bg)"
                        : row.paymentStatus === "Paid" || row.paymentStatus === "Waived"
                        ? "var(--color-row-hover)"
                        : "var(--badge-soon-bg)",
                      color: row.paymentStatus === "Refunded"
                        ? "var(--badge-open-text)"
                        : row.paymentStatus === "Paid" || row.paymentStatus === "Waived"
                        ? "var(--color-primary)"
                        : "var(--badge-soon-text)",
                    };

                    return (
                      <div
                        key={row.id}
                        className="p-4"
                        style={{
                          border: "1px solid var(--color-table-border)",
                          backgroundColor: "var(--color-row-hover)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold">{row.programName}</span>
                              <span
                                className="text-xs px-2 py-0.5"
                                style={{
                                  color: "var(--color-body-text)",
                                  backgroundColor: "var(--color-card-bg)",
                                  border: "1px solid var(--color-table-border)",
                                }}
                              >
                                {row.typeLabel}
                              </span>
                              <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={regBadgeStyle}>
                                Reg. {row.regStatus}
                              </span>
                              <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={payBadgeStyle}>
                                {row.paymentStatus}
                              </span>
                            </div>
                            <p className="text-sm mt-2 whitespace-normal break-words">{row.entryLabel}</p>
                          </div>
                          <div className="flex-shrink-0">
                            <div className="text-right">
                              <div className="font-semibold text-sm whitespace-nowrap" style={{ color: "var(--color-primary)" }}>
                                SGD {row.amount.toFixed(2)}
                              </div>
                              {hasRefund && (
                                <>
                                  <div className="text-xs font-semibold mt-1 whitespace-nowrap" style={{ color: "var(--badge-open-text)" }}>
                                    - SGD {row.refundedAmount.toFixed(2)} refunded
                                  </div>
                                  <div className="text-xs opacity-60 mt-0.5 whitespace-nowrap">
                                    Net SGD {row.netAmount.toFixed(2)}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {(row.remark || row.refundRefs.length > 0) && (
                          <div
                            className="mt-3 px-3 py-2 text-xs"
                            style={{
                              borderTop: "1px dashed var(--color-table-border)",
                              backgroundColor: "var(--color-card-bg)",
                            }}
                          >
                            <div
                              className="grid gap-x-4 gap-y-1"
                              style={{ gridTemplateColumns: "max-content minmax(0, 1fr)" }}
                            >
                              {row.remark && (
                                <>
                                  <span className="font-semibold opacity-60">Remark</span>
                                  <span className="whitespace-normal break-words">{row.remark}</span>
                                </>
                              )}
                              {row.refundRefs.length > 0 && (
                                <>
                                  <span className="font-semibold opacity-60">Refund Ref</span>
                                  <span className="font-mono opacity-70 whitespace-normal break-all">
                                    {row.refundRefs.join(", ")}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

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

  {/*  SECTION 3: Transaction Timeline  */}
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
                          <span className="font-mono">{row.oldStatus ?? "-"}</span>
                          <span className="opacity-40 mx-1">to</span>
                          <span className="font-mono">{row.newStatus ?? "-"}</span>
                        </td>
                        <td className="text-xs opacity-70">{row.performedBy ?? "-"}</td>
                        <td className="text-xs opacity-70">{row.reason ?? row.notes ?? "-"}</td>
                        <td className="font-mono text-xs opacity-50">{row.ipAddress ?? "-"}</td>
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
                          {entry.transactionId ?? entry.gatewayRef ?? "-"}
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
                          {entry.paymentMethod ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        </div>

  {/*  Footer  */}
        <DialogFooter
          className="px-7 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid var(--color-table-border)" }}
        >
  {/* Receipt button anchored left; Close anchored right via flex justify-between */}
          <div className="flex items-center justify-between w-full gap-4">
            <div className="flex items-center gap-3">
              <div title={!hasReceipt ? "Receipt not yet generated - payment must be confirmed first" : undefined}>
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
              <a
                href={detailsPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold"
                style={{
                  border: "1px solid var(--color-table-border)",
                  backgroundColor: "var(--color-row-hover)",
                  color: "var(--color-body-text)",
                  textDecoration: "none",
                }}
              >
                <Download className="h-4 w-4" />
                Download Registration Details PDF
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

//  Small helper sub-components used inside PaymentLogModal

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


// Main page


export default function AdminRegistrations() {
  const [urlParams] = useSearchParams();
  const navigate    = useNavigate();

  //  Filters

  const [filterEvent,   setFilterEvent]   = useState(urlParams.get("event")     || "");
  const [filterProgram, setFilterProgram] = useState(urlParams.get("program")   || "");
  const [filterReg,     setFilterReg]     = useState(urlParams.get("regStatus") || "");  
  const [filterPay,     setFilterPay]     = useState(urlParams.get("payStatus") || "");  
  const initialSearch = urlParams.get("search") || "";
  const [filterSearchInput, setFilterSearchInput] = useState(initialSearch);
  const [filterSearch,  setFilterSearch]  = useState(initialSearch);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  //  Remote state
  const [events,      setEvents]      = useState<TournamentEvent[]>([]);
  const [regs,        setRegs]        = useState<Registration[]>([]);
  const [regTotal,    setRegTotal]    = useState(0);
  const [regTotalPgs, setRegTotalPgs] = useState(1);
  const [refundsByReg, setRefundsByReg] = useState<Record<string, Refund[]>>({});
  const [loadingRegs, setLoadingRegs] = useState(true);
  const [apiError,    setApiError]    = useState("");
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });
  const showSuccess = (title: string, description?: string) =>
    setFeedback({ open: true, variant: "success", title, description });
  const [confirmRegModal,  setConfirmRegModal]  = useState<Registration | null>(null);
  const [confirmRegNote,   setConfirmRegNote]   = useState("");
  const [savingConfirmReg, setSavingConfirmReg] = useState(false);

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
        if (result.error) throw new Error(result.error.message);
        return [reg.id, result.data ?? []] as const;
      }),
    ).then((entries) => {
      if (!active) return;
      setRefundsByReg(Object.fromEntries(entries));
    }).catch((err) => {
      if (!active) return;
      setApiError(err instanceof Error ? err.message : "Refund history could not be loaded.");
    });
    return () => { active = false; };
  }, [regs]);

  const programsForEvent = useMemo(() =>
    events.find(e => e.id === filterEvent)?.programs ?? [], [events, filterEvent]);

  const sorted = useMemo(() => [...regs].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [regs]);
  const paged  = sorted;

  //  Action dropdown
  const [openAction, setOpenAction] = useState<{ reg: Registration; anchorEl: HTMLElement } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilterSearch(filterSearchInput);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filterSearchInput]);

  //  Modals
  const [markPaidModal,   setMarkPaidModal]   = useState<Registration | null>(null);
  const [paymentLogModal, setPaymentLogModal] = useState<Registration | null>(null);
  const [cancelModal,     setCancelModal]     = useState<Registration | null>(null);
  const [refundCancelModal, setRefundCancelModal] = useState<Registration | null>(null);
  const [refundCancelAction, setRefundCancelAction] = useState<RefundCancelAction>("refundOnly");
  const [refundCancelScope, setRefundCancelScope] = useState<RefundCancelScope>("selected");
  const [markPaidMethod,  setMarkPaidMethod]  = useState<PaymentMethod>("PayNow");
  const [markPaidRemark,  setMarkPaidRemark]  = useState("");
  const [cancelReason,    setCancelReason]    = useState("");
  const [refundSel,       setRefundSel]       = useState<Record<string, { checked: boolean; reason: string }>>({});
  const [cancelRefundAction, setCancelRefundAction] = useState<"none" | RefundSource>("none");
  const [cancelRefundSource, setCancelRefundSource] = useState<RefundSource>("System");
  const [cancelRefundMethod, setCancelRefundMethod] = useState<RefundMethod>("GatewayDashboard");
  const [cancelRefundReference, setCancelRefundReference] = useState("");
  const [cancelRefundNote, setCancelRefundNote] = useState("");
  const [refundSource, setRefundSource] = useState<RefundSource>("System");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("GatewayDashboard");
  const [refundReference, setRefundReference] = useState("");
  const [refundAdminNote, setRefundAdminNote] = useState("");
  const [savingMarkPaid,  setSavingMarkPaid]  = useState(false);
  const [savingCancel,    setSavingCancel]    = useState(false);
  const [savingRefund,    setSavingRefund]    = useState(false);

  //  Mutation helpers
  const showApiError = (message: string) => setApiError(message);

  useEffect(() => {
    apiGetEvents()
      .then(r => {
        if (r.data) setEvents(r.data);
        else if (r.error) showApiError(r.error.message);
      })
      .catch(() => showApiError("Events could not be loaded. Please check your connection and try again."));
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
      } else if (r.error) {
        showApiError(r.error.message);
      }
    }).catch(() => {
      showApiError("Registrations could not be loaded. Please check your connection and try again.");
    }).finally(() => setLoadingRegs(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEvent, filterProgram, filterReg, filterPay, filterSearch, page, perPage]);

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
      showSuccess("Payment marked paid", "The registration payment status has been updated.");
    } catch {
      setApiError("Payment could not be updated. Please check your connection and try again.");
    } finally {
      setSavingMarkPaid(false);
    }
  };

  const handleCancel = async (refundMode: CancellationRefundMode) => {
    if (!cancelModal || !cancelReason.trim()) return;
    if (
      refundMode === "refundPaidItems" &&
      cancelRefundAction === "External" &&
      requiresRefundReference(cancelRefundMethod) &&
      !cancelRefundReference.trim()
    ) {
      setApiError("Refund reference / ID is required for this external refund method.");
      return;
    }
    setSavingCancel(true);
    try {
      const cancelR = await apiCancelRegistration(
        cancelModal.id,
        cancelReason,
        refundMode,
        refundMode === "refundPaidItems" && cancelRefundAction === "External"
          ? {
              refundSource: "External",
              refundMethod: cancelRefundMethod,
              refundReference: cancelRefundReference,
              adminNote: cancelRefundNote,
            }
          : undefined,
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
      setCancelRefundAction("none");
      setCancelRefundSource("System");
      setCancelRefundReference("");
      setCancelRefundNote("");
      showSuccess(
        refundMode === "refundPaidItems" ? "Registration cancelled with refund" : "Registration cancelled",
        "The registration record has been updated.",
      );
    } catch {
      setApiError("Registration could not be cancelled. Please check your connection and try again.");
    } finally {
      setSavingCancel(false);
    }
  };

  const getActiveRefundableItemIds = (reg: Registration): string[] => {
    const payment = getPayment(reg);
    if (!payment) return [];
    const refunds = refundsByReg[reg.id] ?? [];
    return refundableItems(payment, refunds).map(item => item.id);
  };

  const isItemScopeActive = (reg: Registration, item: PaymentItem): boolean => {
    const group = reg.groups.find(g => g.id === item.participantGroupId);
    if (!group || group.groupStatus === "X") return false;
    if (!item.participantId) return true;
    const participant = group.participants.find(p => p.id === item.participantId);
    return participant?.participantStatus !== "X";
  };

  const getRefundCancelItems = (reg: Registration, action: RefundCancelAction): PaymentItem[] => {
    const payment = getPayment(reg);
    if (!payment) return [];
    return payment.items;
  };

  const getRefundCancelItemEntryLabel = (reg: Registration, item: PaymentItem): string | null => {
    const group = reg.groups.find(g => g.id === item.participantGroupId);
    const participant = item.participantId
      ? group?.participants.find(p => p.id === item.participantId)
      : null;

    if (item.participantId) {
      return item.playerName || participant?.fullName || null;
    }

    const event = events.find(e => e.id === (group?.eventId || reg.eventId));
    const program = event?.programs.find(p => p.id === group?.programId);
    const isTeamEntry = isTeamProgram(program?.type);

    if (isTeamEntry) {
      return group?.clubDisplay?.trim()
        || group?.namesDisplay?.trim()
        || item.description?.trim()
        || null;
    }

    return group?.namesDisplay?.trim()
      || item.description?.trim()
      || null;
  };

  const canApplyRefundCancelAction = (reg: Registration, item: PaymentItem, action: RefundCancelAction): boolean => {
    if (action === "cancelWithoutRefund") {
      return isItemScopeActive(reg, item);
    }

    const isRefundable = refundableItems(getPayment(reg), refundsByReg[reg.id] ?? [])
      .some(refundable => refundable.id === item.id);

    if (action === "refundOnly") {
      return isRefundable;
    }

    return isItemScopeActive(reg, item) && isRefundable;
  };

  const getEligibleRefundCancelItems = (reg: Registration, action: RefundCancelAction): PaymentItem[] =>
    getRefundCancelItems(reg, action).filter(item => canApplyRefundCancelAction(reg, item, action));

  const getRefundCancelItemDisabledReason = (reg: Registration, item: PaymentItem, action: RefundCancelAction): string | null => {
    if (!isItemScopeActive(reg, item) && action !== "refundOnly") return "Already cancelled";
    if (action === "cancelWithoutRefund") return null;
    if (item.itemStatus === "R") return action === "refundOnly" ? "Already refunded" : "Already refunded - cancel without refund";
    if (getRemainingRefundAmount(reg, item) <= 0) return "No refundable amount";
    if (!canApplyRefundCancelAction(reg, item, action)) return "Not eligible";
    return null;
  };

  const refundCancelItemStatusBadge = (item: PaymentItem): { label: string; bg: string; text: string } => {
    if (item.itemStatus === "R") {
      return { label: "Refunded", bg: "var(--badge-open-bg)", text: "var(--badge-open-text)" };
    }
    if (item.itemStatus === "S") {
      return { label: "Paid", bg: "var(--color-row-hover)", text: "var(--color-primary)" };
    }
    if (item.itemStatus === "X") {
      return { label: "Cancelled", bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" };
    }
    return { label: "Pending", bg: "var(--badge-soon-bg)", text: "var(--badge-soon-text)" };
  };

  const refundCancelScopeBadge = (reg: Registration, item: PaymentItem): { label: string; bg: string; text: string } | null =>
    isItemScopeActive(reg, item)
      ? null
      : { label: "Cancelled", bg: "var(--badge-closed-bg)", text: "var(--badge-closed-text)" };

  const refundCancelSecondaryReason = (reason: string | null): string | null =>
    reason === "Already cancelled" ? null : reason;

  const resetRefundCancelState = () => {
    setRefundCancelModal(null);
    setRefundCancelAction("refundOnly");
    setRefundCancelScope("selected");
    setRefundSel({});
    setCancelReason("");
    setRefundSource("System");
    setRefundMethod("GatewayDashboard");
    setRefundReference("");
    setRefundAdminNote("");
  };

  const getRemainingRefundAmount = (reg: Registration, item: PaymentItem): number => {
    const refunded = (refundsByReg[reg.id] ?? [])
      .filter(r => r.paymentItemId === item.id && r.refundStatus === "S")
      .reduce((sum, r) => sum + r.refundAmount, 0);
    return Math.max(0, item.amount - refunded);
  };

  const cancelSelectedItem = (
    reg: Registration,
    item: PaymentItem,
    refundMode: CancellationRefundMode,
    options?: {
      refundSource?: RefundSource;
      refundMethod?: RefundMethod;
      refundReference?: string;
      adminNote?: string;
      suppressEmail?: boolean;
    },
  ) => {
    if (item.participantId) {
      return apiCancelRegistrationParticipant(reg.id, item.participantId, cancelReason, refundMode, options);
    }
    if (item.participantGroupId) {
      return apiCancelRegistrationGroup(reg.id, item.participantGroupId, cancelReason, refundMode, options);
    }
    return apiCancelRegistration(reg.id, cancelReason, refundMode, options);
  };

  const handleRefundCancel = async () => {
    if (!refundCancelModal || !cancelReason.trim()) return;
    const payment = getPayment(refundCancelModal);
    if (!payment) { setApiError("This registration has no payment record."); return; }

    const involvesRefund = refundCancelAction !== "cancelWithoutRefund";
    const refundOptions = refundSource === "External"
      ? {
          refundSource: "External" as const,
          refundMethod,
          refundReference,
          adminNote: refundAdminNote,
        }
      : undefined;

    if (involvesRefund && refundSource === "External" && requiresRefundReference(refundMethod) && !refundReference.trim()) {
      setApiError("Refund reference / ID is required for this external refund method.");
      return;
    }

    const availableItems = getEligibleRefundCancelItems(refundCancelModal, refundCancelAction);
    const selectedItems = availableItems.filter(item => refundSel[item.id]?.checked);

    if (refundCancelScope === "selected" && selectedItems.length === 0) {
      setApiError("Select at least one item.");
      return;
    }

    if (involvesRefund && selectedItems.length === 0) {
      setApiError("There are no refundable paid items for this action.");
      return;
    }

    setSavingRefund(true);
    try {
      const actionErrors: string[] = [];

      if (refundCancelAction === "refundOnly") {
        const refundItems = selectedItems
          .map(item => ({
            paymentItemId: item.id,
            refundAmount: getRemainingRefundAmount(refundCancelModal, item),
          }))
          .filter(item => item.refundAmount > 0);

        const result = await apiInitiateRefunds(
          refundCancelModal.id,
          refundItems,
          cancelReason,
          refundOptions,
        );
        if (result.error) {
          actionErrors.push(result.error.message);
        }
        if (result.data?.errors?.length) {
          actionErrors.push(...result.data.errors);
        }
      } else if (refundCancelScope === "whole") {
        const result = await apiCancelRegistration(
          refundCancelModal.id,
          cancelReason,
          refundCancelAction === "cancelWithRefund" ? "refundPaidItems" : "none",
          refundCancelAction === "cancelWithRefund" ? refundOptions : undefined,
        );
        if (result.error) actionErrors.push(result.error.message);
        if (result.data?.errors?.length) actionErrors.push(...result.data.errors);
      } else {
        let actionSucceeded = false;
        for (const item of selectedItems) {
          const result = await cancelSelectedItem(
            refundCancelModal,
            item,
            refundCancelAction === "cancelWithRefund" ? "refundPaidItems" : "none",
            {
              ...(refundCancelAction === "cancelWithRefund" ? refundOptions : undefined),
              suppressEmail: true,
            },
          );
          if (result.error) actionErrors.push(`${item.programName}: ${result.error.message}`);
          else actionSucceeded = true;
          if (result.data?.errors?.length) {
            actionErrors.push(...result.data.errors.map(error => `${item.programName}: ${error}`));
          }
        }
        if (actionSucceeded) {
          const notificationScope = selectedItems.length === 1
            ? selectedItems[0].participantId ? "participant" : "entry"
            : "registration";
          const notification = await apiSendCancellationNotification(
            refundCancelModal.id,
            cancelReason,
            notificationScope,
            refundCancelAction === "cancelWithRefund",
          );
          if (notification.error) actionErrors.push(notification.error.message);
        }
      }

      const [regR, refR] = await Promise.all([
        apiGetRegistration(refundCancelModal.id),
        apiGetRefunds(refundCancelModal.id),
      ]);
      if (regR.data) {
        setRegs(prev => prev.map(r => r.id === refundCancelModal.id ? regR.data! : r));
      }
      if (refR.data) {
        setRefundsByReg(prev => ({ ...prev, [refundCancelModal.id]: refR.data! }));
      }

      if (actionErrors.length > 0) {
        setApiError(`Action completed with issues: ${actionErrors.join(" | ")}`);
        return;
      }

      const successTitle = refundCancelAction === "refundOnly"
        ? "Refund processed"
        : refundCancelAction === "cancelWithRefund"
          ? "Cancellation with refund processed"
          : "Cancellation processed";
      resetRefundCancelState();
      showSuccess(successTitle, "The registration record has been updated.");
    } catch {
      setApiError("Action could not be completed. Please check the latest payment and registration status before retrying.");
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
        adminNote: confirmRegNote.trim() || "Admin confirmed - Payment verified",
      });
      if (r.error) { setApiError(r.error.message); return; }
      if (r.data) {
        setRegs(prev => prev.map(reg => reg.id === r.data!.id ? r.data! : reg));
      }
      setConfirmRegModal(null);
      setConfirmRegNote("");
      showSuccess("Registration confirmed", "The registration has been confirmed.");
    } catch {
      setApiError("Registration could not be confirmed. Please check your connection and try again.");
    } finally {
      setSavingConfirmReg(false);
    }
  };


  // RENDER

  return (
    <div>
      <ActionFeedbackDialog
        open={feedback.open || !!apiError}
        variant={apiError ? "error" : feedback.variant}
        title={apiError ? "Action could not be completed" : feedback.title}
        description={apiError || feedback.description}
        onOpenChange={open => {
          if (!open) {
            setApiError("");
            setFeedback(prev => ({ ...prev, open: false }));
          }
        }}
      />
      <div className="flex items-center justify-between mb-8">
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>Registrations &amp; Payments</h1></div>
      </div>

  {/* REGISTRATIONS */}
      <>
  {/* Filters */}
        <div className="p-5 mb-6" style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
          <div className="grid grid-cols-2 md:flex md:flex-wrap items-end gap-4">
            <FG label="Search">
              <input className="field-input w-52" placeholder="Reg no. or contact person..."
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
                <option value="C">Confirmed</option>
                <option value="P">Pending</option>
                <option value="CP">Cancel Pending</option>
                <option value="RF">Refund Failed</option>
                <option value="X">Cancelled</option>
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
                <tr><td colSpan={10} className="text-center py-6"><LoadingSpinner size="sm" label="Loading registrations..." /></td></tr>
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
                    <tr style={reg.regStatus === "P" || payment?.paymentStatus === "P"
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

  {/* ACTION DROPDOWN */}
      <ActionDropdownPortal
        open={!!openAction}
        anchorEl={openAction?.anchorEl ?? null}
        onClose={() => setOpenAction(null)}
      >
        {openAction && (
          <>
            <button
              disabled={!(["P", "PC"].includes(getPayment(openAction.reg)?.paymentStatus ?? "") && openAction.reg.regStatus !== "X")}
              onClick={() => { setMarkPaidModal(openAction.reg); setOpenAction(null); }}
            >
              <CheckCircle className="h-4 w-4" /> Mark as Paid
            </button>
            <button
              disabled={!(
                openAction.reg.regStatus === "P" &&
                getPayment(openAction.reg)?.paymentStatus === "S"
              )}
              onClick={() => { setConfirmRegModal(openAction.reg); setOpenAction(null); }}
            >
              <CheckCircle className="h-4 w-4" /> Confirm Registration
            </button>
            {(() => {
              const canRefund = getEligibleRefundCancelItems(openAction.reg, "refundOnly").length > 0;
              const canCancel = openAction.reg.regStatus !== "X";
              return (
                <button
                  disabled={!(canRefund || canCancel)}
                  onClick={() => {
                    setRefundSel({});
                    setCancelReason("");
                    setRefundCancelAction(canRefund ? "refundOnly" : "cancelWithoutRefund");
                    setRefundCancelScope("selected");
                    setRefundCancelModal(openAction.reg);
                    setOpenAction(null);
                  }}
                >
                  <RefreshCw className="h-4 w-4" /> Refund / Cancel
                </button>
              );
            })()}
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
          </>
        )}
      </ActionDropdownPortal>

  {/* MODALS */}

  {/* Mark as Paid */}
      <Dialog open={!!markPaidModal} onOpenChange={v => { if (!v) { setMarkPaidModal(null); setMarkPaidRemark(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Mark as Paid</DialogTitle>
            {markPaidModal && (
              <p className="text-xs opacity-50 mt-1">
                {markPaidModal.id} - {markPaidModal.groups.map(g => g.programName).join(", ")} - Total: ${getPayment(markPaidModal) ? totalFee(markPaidModal).toFixed(2) : "0.00"}
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
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {savingMarkPaid ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : "Confirm Payment"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

  {/* Refund / Cancel */}
      <Dialog open={!!refundCancelModal} onOpenChange={v => { if (!v) resetRefundCancelState(); }}>
        <DialogContent className="w-[min(96vw,1040px)] max-w-5xl max-h-[94vh] overflow-y-auto p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-6 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Refund / Cancel</DialogTitle>
            {refundCancelModal && <p className="text-xs mt-1">{refundCancelModal.id} - {refundCancelModal.contactName}</p>}
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className={refundCancelAction !== "cancelWithoutRefund" ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
              <FG label="Action">
                <select
                  className="field-input"
                  value={refundCancelAction}
                  onChange={e => {
                    const action = e.target.value as RefundCancelAction;
                    setRefundCancelAction(action);
                    setRefundSel({});
                    setRefundCancelScope("selected");
                  }}
                >
                  <option value="refundOnly">Refund only</option>
                  <option value="cancelWithoutRefund">Cancel without refund</option>
                  <option value="cancelWithRefund">Cancel with refund</option>
                </select>
              </FG>

              {refundCancelAction !== "cancelWithoutRefund" && (
                <FG label="Refund mode">
                  <select className="field-input" value={refundSource} onChange={e => setRefundSource(e.target.value as RefundSource)}>
                    <option value="System">Internal System Refund</option>
                    <option value="External">Record External Refund</option>
                  </select>
                </FG>
              )}
            </div>

            <label className="flex items-center justify-between gap-4 p-4 cursor-pointer"
              style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}>
              <div>
                <div className="text-sm font-semibold">Apply to all eligible items</div>
                <div className="text-xs opacity-60 mt-1">
                  {refundCancelScope === "whole"
                    ? "All listed items will be included."
                    : "Choose individual items below."}
                </div>
              </div>
              <Switch
                checked={refundCancelScope === "whole"}
                onCheckedChange={checked => {
                  setRefundCancelScope(checked ? "whole" : "selected");
                  if (checked && refundCancelModal) {
                    const eligibleItems = getEligibleRefundCancelItems(refundCancelModal, refundCancelAction);
                    setRefundSel(Object.fromEntries(
                      eligibleItems.map(item => [item.id, { checked: true, reason: cancelReason }]),
                    ));
                  } else {
                    setRefundSel({});
                  }
                }}
              />
            </label>

            {refundCancelAction !== "cancelWithoutRefund" && refundSource === "External" && (
              <div className="grid gap-4 md:grid-cols-3">
                <FG label="Refund method *">
                  <select className="field-input" value={refundMethod} onChange={e => setRefundMethod(e.target.value as RefundMethod)}>
                    {EXTERNAL_REFUND_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </FG>
                <FG label={`Refund reference / ID${requiresRefundReference(refundMethod) ? " *" : " (optional)"}`}>
                  <input className="field-input" value={refundReference} onChange={e => setRefundReference(e.target.value)} />
                </FG>
                <FG label="Admin note (optional)">
                  <input className="field-input" value={refundAdminNote} onChange={e => setRefundAdminNote(e.target.value)} />
                </FG>
              </div>
            )}

            {refundCancelModal && (() => {
              const items = getRefundCancelItems(refundCancelModal, refundCancelAction);
              return (
                <div className="space-y-3">
                  <p className="block text-xs font-semibold mb-1.5">
                    {refundCancelScope === "whole" ? "Included items" : "Select items"}
                  </p>
                  {items.length === 0 && (
                    <div className="p-3 text-xs" style={{ backgroundColor: "var(--color-row-hover)", color: "var(--color-body-text)" }}>
                      No eligible items for this action.
                    </div>
                  )}
                  <div className="grid gap-3 lg:grid-cols-2">
                    {items.map(item => {
                      const disabledReason = getRefundCancelItemDisabledReason(refundCancelModal, item, refundCancelAction);
                      const eligible = !disabledReason;
                      const checked = eligible && (refundSel[item.id]?.checked ?? false);
                      const statusBadge = refundCancelItemStatusBadge(item);
                      const scopeBadge = refundCancelScopeBadge(refundCancelModal, item);
                      const secondaryReason = refundCancelSecondaryReason(disabledReason);
                      const entryLabel = getRefundCancelItemEntryLabel(refundCancelModal, item);
                      const showScopeBadge = !!scopeBadge && scopeBadge.label !== statusBadge.label;
                      return (
                        <label key={item.id} className="flex items-start gap-3 p-4 cursor-pointer min-h-[94px]"
                          style={{
                            border: "1px solid var(--color-table-border)",
                            opacity: eligible ? 1 : 0.55,
                            cursor: eligible ? "pointer" : "default",
                          }}>
                          <Switch
                            disabled={!eligible}
                            checked={checked}
                            onCheckedChange={v => {
                              if (!v) setRefundCancelScope("selected");
                              setRefundSel(prev => ({ ...prev, [item.id]: { checked: v, reason: cancelReason } }));
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-sm font-medium truncate">{item.programName}</span>
                                  <span className="text-xs px-1.5 py-0.5 font-semibold flex-shrink-0"
                                    style={{ backgroundColor: statusBadge.bg, color: statusBadge.text }}>
                                    {statusBadge.label}
                                  </span>
                                  {showScopeBadge && scopeBadge && (
                                    <span className="text-xs px-1.5 py-0.5 font-semibold flex-shrink-0"
                                      style={{ backgroundColor: scopeBadge.bg, color: scopeBadge.text }}>
                                      {scopeBadge.label}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs mt-1">
                                  {entryLabel && <span className="opacity-60">- {entryLabel}</span>}
                                  {!item.participantId && <span className="opacity-40 ml-2">(per entry)</span>}
                                  {secondaryReason && <span className="opacity-50 ml-2">{secondaryReason}</span>}
                                </div>
                              </div>
                              <span className="font-bold text-sm flex-shrink-0" style={{ color: "var(--color-primary)" }}>
                                ${item.amount.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <FG label="Reason *">
              <textarea className="field-input" rows={3} value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Enter reason..." />
            </FG>
          </div>
          <DialogFooter className="p-6 pt-0">
            <button onClick={resetRefundCancelState} className="btn-outline px-5 py-2.5 text-sm">Close</button>
            {refundCancelModal && (() => {
              const eligibleItems = getEligibleRefundCancelItems(refundCancelModal, refundCancelAction);
              const hasSelected = eligibleItems.some(item => refundSel[item.id]?.checked);
              return (
                <button
                  onClick={handleRefundCancel}
                  disabled={!cancelReason.trim() || savingRefund || !hasSelected}
                  className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2">
                  {savingRefund ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</> : "Proceed"}
                </button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!confirmRegModal} onOpenChange={v => { if (!v) { setConfirmRegModal(null); setConfirmRegNote(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Confirm Registration</DialogTitle>
            {confirmRegModal && (
              <p className="text-xs opacity-50 mt-1">
                {confirmRegModal.id} - {confirmRegModal.contactName} - ${getPayment(confirmRegModal) ? totalFee(confirmRegModal).toFixed(2) : "0.00"}
              </p>
            )}
          </DialogHeader>
          <div className="p-7 space-y-4">
            <div className="px-3 py-2 text-xs"
              style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
              Stripe payment is confirmed (status S). Confirming this registration will set
              RegStatus to C and send the confirmation email.
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
      <Dialog open={!!cancelModal} onOpenChange={v => { if (!v) { setCancelModal(null); setCancelReason(""); setCancelRefundAction("none"); setCancelRefundSource("System"); setCancelRefundReference(""); setCancelRefundNote(""); } }}>
        <DialogContent className="max-w-md p-0" style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}>
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Cancel Registration</DialogTitle>
          </DialogHeader>
          <div className="p-7 space-y-4">
            {(() => {
              const payment = getPayment(cancelModal as Registration);
              const refunds = cancelModal ? (refundsByReg[cancelModal.id] ?? []) : [];
              const count = refundableItems(payment, refunds).length;
              return (
                <>
                  <FG label="Refund mode">
                    <select
                      className="field-input"
                      value={cancelRefundAction}
                      onChange={e => {
                        const value = e.target.value as "none" | RefundSource;
                        setCancelRefundAction(value);
                        if (value !== "none") setCancelRefundSource(value);
                      }}
                    >
                      <option value="none">Cancel Without Refund</option>
                      <option value="System" disabled={count === 0}>Cancel With Internal System Refund</option>
                      <option value="External" disabled={count === 0}>Cancel With Record External Refund</option>
                    </select>
                  </FG>
                  {cancelRefundAction === "External" && (
                    <div className="space-y-3">
                      <FG label="Refund method *">
                        <select className="field-input" value={cancelRefundMethod} onChange={e => setCancelRefundMethod(e.target.value as RefundMethod)}>
                          {EXTERNAL_REFUND_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </FG>
                      <FG label={`Refund reference / ID${requiresRefundReference(cancelRefundMethod) ? " *" : " (optional)"}`}>
                        <input className="field-input" value={cancelRefundReference} onChange={e => setCancelRefundReference(e.target.value)} />
                      </FG>
                      <FG label="Admin note (optional)">
                        <input className="field-input" value={cancelRefundNote} onChange={e => setCancelRefundNote(e.target.value)} />
                      </FG>
                    </div>
                  )}
                </>
              );
            })()}
            <FG label="Reason *">
              <textarea className="field-input" rows={3} value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Enter reason for cancellation..." />
            </FG>
          </div>
          <DialogFooter className="p-7 pt-0">
            <button onClick={() => { setCancelModal(null); setCancelReason(""); }} className="btn-outline px-5 py-2.5 text-sm">Close</button>
            {(() => {
              const payment = getPayment(cancelModal as Registration);
              const refunds = cancelModal ? (refundsByReg[cancelModal.id] ?? []) : [];
              const canRefund = refundableItems(payment, refunds).length > 0;
              const selectedRefundMode = cancelRefundAction === "none" ? "none" : "refundPaidItems";
              return (
                <button
                  onClick={() => handleCancel(selectedRefundMode)}
                  disabled={!cancelReason.trim() || savingCancel || (cancelRefundAction !== "none" && !canRefund)}
                  className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-2">
                  {savingCancel ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</> : "Proceed"}
                </button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

  {/* Payment Log - full-width redesigned panel */}
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
