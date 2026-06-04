/**
 * AdminPayments.tsx  — /admin/payments
 *
 * Tab 1 "Registration Issues": links to /admin/registrations pre-filtered
 *   for Case A (Confirmed reg + Pending payment) and Case B (Pending reg + Paid).
 *   No duplication of the registrations table — just deep links with filters.
 *
 * Tab 2 "Unmatched Stripe Payments": Case-C rows from WebhookLog.
 *   Displays payer contact info stored in metadata. One action: Refund.
 *
 * Follows the exact same table/modal patterns as Registrations.tsx.
 */

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { apiGetWebhookFailures, apiRefundOrphanedPayment } from "@/lib/api";
import type { WebhookFailure } from "@/types/registration";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

// ── small helpers (same style as Registrations.tsx) ──────────────────────────

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 opacity-60">{label}</label>
      {children}
    </div>
  );
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-SG", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Tab button (matches visual style of existing admin tabs if any) ───────────

function Tab({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-5 py-3 text-sm font-medium flex items-center gap-2"
      style={{
        borderBottom: active ? "2px solid var(--color-primary)" : "2px solid transparent",
        color: active ? "var(--color-primary)" : undefined,
        opacity: active ? 1 : 0.55,
      }}
    >
      {label}
      {count > 0 && (
        <span
          className="text-xs font-bold px-1.5 py-0.5"
          style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPayments() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"issues" | "unmatched">("issues");

  // Case-C state
  const [failures,     setFailures]     = useState<WebhookFailure[]>([]);
  const [loadingC,     setLoadingC]     = useState(true);
  const [apiError,     setApiError]     = useState("");

  // Refund modal state
  const [refundTarget, setRefundTarget] = useState<WebhookFailure | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundNote,   setRefundNote]   = useState("");
  const [savingRefund, setSavingRefund] = useState(false);

  useEffect(() => {
    apiGetWebhookFailures()
      .then(r => {
        if (r.data) setFailures(r.data);
        else if (r.error) setApiError(r.error.message);
      })
      .finally(() => setLoadingC(false));
  }, []);

  const handleRefund = async () => {
    if (!refundTarget || !refundReason.trim()) return;
    setSavingRefund(true);
    try {
      const r = await apiRefundOrphanedPayment(
        refundTarget.webhookLogId,
        refundReason,
        refundNote,
      );
      if (r.error) { setApiError(r.error.message); return; }
      // Remove from list on success
      setFailures(prev => prev.filter(f => f.webhookLogId !== refundTarget.webhookLogId));
      setRefundTarget(null);
      setRefundReason("");
      setRefundNote("");
    } finally {
      setSavingRefund(false);
    }
  };

  return (
    <div>
      <div className="sticky-header">
        <div className="admin-page-title"><h1>Payment Reconciliation</h1></div>
        {apiError && (
          <div
            className="mb-4 px-4 py-3 text-sm font-medium flex items-center justify-between"
            style={{
              backgroundColor: "var(--badge-closed-bg)",
              color: "var(--badge-closed-text)",
              border: "1px solid var(--badge-closed-text)",
            }}
          >
            <span>{apiError}</span>
            <button onClick={() => setApiError("")} className="ml-4 opacity-60 hover:opacity-100 text-xs font-bold">✕</button>
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex" style={{ borderBottom: "1px solid var(--color-table-border)", marginBottom: 20 }}>
        <Tab
          label="Registration Issues"
          count={0}
          active={activeTab === "issues"}
          onClick={() => setActiveTab("issues")}
        />
        <Tab
          label="Unmatched Stripe Payments"
          count={failures.length}
          active={activeTab === "unmatched"}
          onClick={() => setActiveTab("unmatched")}
        />
      </div>

      {/* ══════════ TAB 1: Registration Issues ══════════ */}
      {activeTab === "issues" && (
        <div className="space-y-4">
          <p className="text-sm opacity-60">
            These cases exist in the registrations table. Use the filters below to go directly to each case type.
          </p>

          {/* Case A */}
          <div
            className="p-5 flex items-start justify-between gap-4"
            style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4" style={{ color: "var(--badge-soon-text)" }} />
                <p className="text-sm font-semibold">Case A — Confirmed registration, payment pending</p>
              </div>
              <p className="text-xs opacity-60">
                Registration is confirmed but payment has not been received. Use <strong>Mark as Paid</strong> to record offline payment (cash, bank transfer etc.).
              </p>
            </div>
            <button
              className="btn-outline px-4 py-2 text-sm flex items-center gap-2 flex-shrink-0"
              onClick={() => navigate("/admin/registrations?regStatus=Confirmed&payStatus=P")}
            >
              View in Registrations <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Case B */}
          <div
            className="p-5 flex items-start justify-between gap-4"
            style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4" style={{ color: "var(--badge-closed-text)" }} />
                <p className="text-sm font-semibold">Case B — Payment succeeded, registration still pending</p>
              </div>
              <p className="text-xs opacity-60">
                Stripe collected money but the registration was not confirmed (edge case in the session-first flow).
                Use <strong>Confirm Registration</strong> to complete it, or <strong>Refund &amp; void</strong> to return the money.
              </p>
            </div>
            <button
              className="btn-outline px-4 py-2 text-sm flex items-center gap-2 flex-shrink-0"
              onClick={() => navigate("/admin/registrations?regStatus=Pending&payStatus=S")}
            >
              View in Registrations <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ══════════ TAB 2: Unmatched Stripe Payments (Case C) ══════════ */}
      {activeTab === "unmatched" && (
        <>
          {failures.length > 0 && (
            <div
              className="mb-4 px-4 py-3 text-sm flex items-center gap-3"
              style={{
                backgroundColor: "var(--badge-closed-bg)",
                color: "var(--badge-closed-text)",
                border: "1px solid var(--badge-closed-text)",
              }}
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>
                Stripe collected money for these sessions but no registration was created.
                Contact the payer and issue a refund.
              </span>
            </div>
          )}

          <div style={{ border: "1px solid var(--color-table-border)" }}>
            <table className="trs-table">
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>Contact</th>
                  <th>Amount</th>
                  <th>Received</th>
                  <th>Retries</th>
                  <th>Session ID</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loadingC && (
                  <tr>
                    <td colSpan={7} className="text-center py-6">
                      <LoadingSpinner size="sm" label="Loading…" />
                    </td>
                  </tr>
                )}
                {!loadingC && failures.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-10 opacity-40">
                      <CheckCircle className="h-5 w-5 inline mr-2" />
                      No unmatched payments — all clear.
                    </td>
                  </tr>
                )}
                {failures.map(f => (
                  <tr key={f.webhookLogId}>
                    <td>
                      <p className="font-semibold text-sm">{f.contactName ?? "—"}</p>
                    </td>
                    <td>
                      <p className="text-sm">{f.contactEmail ?? "—"}</p>
                      <p className="text-xs opacity-50">{f.contactPhone ?? "—"}</p>
                    </td>
                    <td className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
                      {f.currency} {f.amount != null ? f.amount.toFixed(2) : "—"}
                    </td>
                    <td className="text-xs opacity-60 whitespace-nowrap">
                      {formatDateTime(f.receivedAt)}
                    </td>
                    <td className="text-xs text-center opacity-60">{f.retryCount}</td>
                    <td className="font-mono text-xs opacity-50 max-w-[160px] truncate" title={f.gatewaySessionId}>
                      {f.gatewaySessionId}
                    </td>
                    <td>
                      <button
                        className="btn-outline px-3 py-1.5 text-xs"
                        style={{ color: "var(--badge-closed-text)", borderColor: "var(--badge-closed-text)" }}
                        onClick={() => { setRefundTarget(f); setRefundReason(""); setRefundNote(""); }}
                      >
                        Refund
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ══════════ REFUND MODAL (Case C) ══════════ */}
      <Dialog open={!!refundTarget} onOpenChange={v => { if (!v) setRefundTarget(null); }}>
        <DialogContent
          className="max-w-md p-0"
          style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}
        >
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Refund Unmatched Payment</DialogTitle>
            {refundTarget && (
              <p className="text-xs opacity-50 mt-1">
                {refundTarget.currency} {refundTarget.amount?.toFixed(2)} ·{" "}
                {refundTarget.contactName ?? refundTarget.contactEmail ?? refundTarget.gatewaySessionId}
              </p>
            )}
          </DialogHeader>

          {refundTarget && (
            <div className="p-7 space-y-4">
              {/* Payer info summary */}
              <div
                className="p-4 grid gap-2 text-sm"
                style={{ border: "1px solid var(--color-table-border)", backgroundColor: "var(--color-row-hover)" }}
              >
                <div className="flex justify-between">
                  <span className="opacity-50">Name</span>
                  <span className="font-medium">{refundTarget.contactName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-50">Email</span>
                  <span className="font-medium font-mono text-xs">{refundTarget.contactEmail ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-50">Phone</span>
                  <span className="font-medium">{refundTarget.contactPhone ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-50">Amount</span>
                  <span className="font-bold" style={{ color: "var(--color-primary)" }}>
                    {refundTarget.currency} {refundTarget.amount?.toFixed(2)}
                  </span>
                </div>
              </div>

              <div
                className="px-3 py-2 text-xs"
                style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}
              >
                ⚠ This will issue a full refund via Stripe. This action cannot be undone.
              </div>

              <FG label="Reason *">
                <textarea
                  className="field-input"
                  rows={2}
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  placeholder="e.g. PendingCheckout missing — payer contacted and confirmed"
                />
              </FG>

              <FG label="Admin note (optional)">
                <input
                  className="field-input"
                  value={refundNote}
                  onChange={e => setRefundNote(e.target.value)}
                  placeholder="e.g. Payer called on 24 May, agreed to re-register"
                />
              </FG>
            </div>
          )}

          <DialogFooter className="p-7 pt-0">
            <button onClick={() => setRefundTarget(null)} className="btn-outline px-5 py-2.5 text-sm">
              Cancel
            </button>
            <button
              onClick={handleRefund}
              disabled={!refundReason.trim() || savingRefund}
              className="px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--badge-closed-text)", color: "white" }}
            >
              {savingRefund ? "Processing…" : "Confirm Refund"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}