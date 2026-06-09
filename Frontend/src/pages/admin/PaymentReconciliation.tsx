

import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";
import { apiGetWebhookFailures, apiRefundOrphanedPayment } from "@/lib/api";
import type { WebhookFailure } from "@/types/registration";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import LoadingSpinner from "@/components/ui/LoadingSpinner";

// ── small helpers ─────────────────────────────────────────────────────────────

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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PaymentReconciliation() {
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

      {/* ══════════ Unmatched Stripe Payments (Case C) ══════════ */}

      <p className="text-sm opacity-60 mb-4">
        Stripe payments where no registration was created — the payer completed checkout but the
        session was never matched to a TRS registration. Issue a refund directly from here.
      </p>

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
            {failures.length} unmatched payment{failures.length !== 1 ? "s" : ""} — contact each payer and issue a refund.
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

      {/* ══════════ REFUND MODAL ══════════ */}
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
                ⚠ This will issue a full refund via Stripe and record it in TRS. This action cannot be undone.
              </div>

              <FG label="Reason *">
                <textarea
                  className="field-input"
                  rows={2}
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  placeholder="e.g. No matching registration found — payer contacted and confirmed"
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