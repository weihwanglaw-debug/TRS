

import React, { useState, useEffect, useCallback } from "react";
import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { apiGetWebhookFailures, apiGetOrphanRefundHistory, apiMarkWebhookFailureReviewed, apiRecordExternalOrphanRefund, apiRefundOrphanedPayment } from "@/lib/api";
import type { OrphanRefundHistory, RefundMethod, RefundSource, WebhookFailure } from "@/types/registration";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { ActionFeedbackDialog, type ActionFeedbackVariant } from "@/components/ui/ActionFeedbackDialog";
import AdminTabs from "@/components/admin/AdminTabs";

// ── small helpers ─────────────────────────────────────────────────────────────

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5">{label}</label>
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

// ── Main page ─────────────────────────────────────────────────────────────────

function RefundStatusBadge({ status }: { status: string }) {
  const config: Record<string, [string, string, string]> = {
    S: ["Refunded", "var(--badge-open-bg)", "var(--badge-open-text)"],
    P: ["Pending", "var(--badge-soon-bg)", "var(--badge-soon-text)"],
    F: ["Failed", "var(--badge-closed-bg)", "var(--badge-closed-text)"],
  };
  const [label, bg, color] = config[status] ?? [status || "-", "var(--color-row-hover)", "var(--color-body-text)"];
  return (
    <span className="inline-flex px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  );
}

export default function PaymentReconciliation() {
  const [activeTab,    setActiveTab]    = useState<"active" | "history">("active");
  const [failures,     setFailures]     = useState<WebhookFailure[]>([]);
  const [history,      setHistory]      = useState<OrphanRefundHistory[]>([]);
  const [loadingC,     setLoadingC]     = useState(true);
  const [loadingH,     setLoadingH]     = useState(true);
  const [apiError,     setApiError]     = useState("");
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: ActionFeedbackVariant;
    title: string;
    description?: string;
  }>({ open: false, variant: "info", title: "" });
  const [failuresLoadError, setFailuresLoadError] = useState("");
  const showSuccess = (title: string, description?: string) =>
    setFeedback({ open: true, variant: "success", title, description });

  // Refund modal state
  const [refundTarget, setRefundTarget] = useState<WebhookFailure | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundNote,   setRefundNote]   = useState("");
  const [savingRefund, setSavingRefund] = useState(false);
  const [refundSource, setRefundSource] = useState<RefundSource>("System");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("GatewayDashboard");
  const [refundReference, setRefundReference] = useState("");
  const [reviewTarget, setReviewTarget] = useState<WebhookFailure | null>(null);
  const [reviewNote,   setReviewNote]   = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const loadFailures = useCallback(() => {
    setLoadingC(true);
    setFailuresLoadError("");
    setApiError("");
    apiGetWebhookFailures()
      .then(r => {
        if (r.data) setFailures(r.data);
        else if (r.error) {
          setFailures([]);
          setFailuresLoadError(r.error.message);
          setApiError(r.error.message);
        }
      })
      .catch(() => {
        const message = "Couldn't load unmatched payments. Check your connection and retry.";
        setFailures([]);
        setFailuresLoadError(message);
        setApiError(message);
      })
      .finally(() => setLoadingC(false));
  }, []);

  const loadHistory = useCallback(() => {
    setLoadingH(true);
    apiGetOrphanRefundHistory()
      .then(r => {
        if (r.data) setHistory(r.data);
        else if (r.error) setApiError(r.error.message);
      })
      .catch(() => setApiError("Couldn't load refund history. Check your connection and retry."))
      .finally(() => setLoadingH(false));
  }, []);

  useEffect(() => {
    loadFailures();
    loadHistory();
  }, [loadFailures, loadHistory]);

  const handleRefund = async () => {
    if (!refundTarget || !refundReason.trim()) return;
    if (refundSource === "External" && requiresRefundReference(refundMethod) && !refundReference.trim()) {
      setApiError("Refund reference / ID is required for this external refund method.");
      return;
    }
    setSavingRefund(true);
    try {
      const r = refundSource === "External"
        ? await apiRecordExternalOrphanRefund(
            refundTarget.webhookLogId,
            refundTarget.amount,
            refundMethod,
            refundReference,
            refundReason,
            refundNote,
          )
        : await apiRefundOrphanedPayment(
            refundTarget.webhookLogId,
            refundReason,
            refundNote,
          );
      if (r.error) { setApiError(r.error.message); return; }
      setFailures(prev => prev.filter(f => f.webhookLogId !== refundTarget.webhookLogId));
      loadHistory();
      setRefundTarget(null);
      setRefundReason("");
      setRefundNote("");
      setRefundSource("System");
      setRefundReference("");
      showSuccess(refundSource === "External" ? "External refund recorded" : "Refund executed", "The reconciliation row has been resolved.");
    } catch {
      setApiError("Network error - please check whether the refund went through before retrying.");
    } finally {
      setSavingRefund(false);
    }
  };

  const handleMarkReviewed = async () => {
    if (!reviewTarget || !reviewNote.trim()) return;
    setSavingReview(true);
    try {
      const r = await apiMarkWebhookFailureReviewed(reviewTarget.webhookLogId, reviewNote);
      if (r.error) { setApiError(r.error.message); return; }
      setFailures(prev => prev.filter(f => f.gatewaySessionId !== reviewTarget.gatewaySessionId));
      setReviewTarget(null);
      setReviewNote("");
      showSuccess("Marked reviewed", "The refund discrepancy has been removed from the active list.");
    } catch {
      setApiError("Couldn't mark the refund discrepancy reviewed. Check your connection and retry.");
    } finally {
      setSavingReview(false);
    }
  };

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
        <div className="admin-page-title" style={{ marginBottom: 0 }}><h1>Payment Reconciliation</h1></div>
        {failuresLoadError && (
          <button
            type="button"
            onClick={loadFailures}
            className="btn-outline flex items-center gap-1.5 px-4 py-2 text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry unmatched payments
          </button>
        )}
      </div>



      <p className="text-sm opacity-60 mb-4">
        Payments where no registration was created
      </p>

      <AdminTabs<"active" | "history">
        tabs={[
          { key: "active", label: `Active (${failures.length})` },
          { key: "history", label: `Refund History (${history.length})` },
        ]}
        activeKey={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "active" && (
        <>
      {failures.length > 0 && (
        <div
          className="mb-4 px-4 py-3 text-sm flex items-center gap-3"
          style={{
            backgroundColor: "var(--badge-closed-bg)",
            color: "var(--badge-open-text)",
            border: "1px solid var(--badge-open-text)",
          }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>
            {failures.length} unmatched payment{failures.length !== 1 ? "s" : ""} — contact each payer and issue a refund.
          </span>
        </div>
      )}

      <div className="hidden md:block overflow-x-auto" style={{ border: "1px solid var(--color-table-border)" }}>
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
            {!loadingC && failuresLoadError && (
              <tr>
                <td colSpan={7} className="text-center py-10">
                  <div className="flex flex-col items-center gap-3 text-sm">
                    <span>{failuresLoadError}</span>
                    <button type="button" onClick={loadFailures} className="btn-outline flex items-center gap-1.5 px-4 py-2 text-xs font-semibold">
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!loadingC && !failuresLoadError && failures.length === 0 && (
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
                    onClick={() => {
                      if (f.eventType === "charge.refunded") {
                        setReviewTarget(f);
                        setReviewNote("");
                      } else {
                        setRefundTarget(f);
                        setRefundReason("");
                        setRefundNote("");
                        setRefundSource("System");
                        setRefundReference("");
                      }
                    }}
                  >
                    {f.eventType === "charge.refunded" ? "Mark Reviewed" : "Refund"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {loadingC && (
          <div className="text-center py-10">
            <LoadingSpinner size="sm" label="Loading..." />
          </div>
        )}
        {!loadingC && failuresLoadError && (
          <div className="text-center py-10 text-sm">
            <p>{failuresLoadError}</p>
            <button type="button" onClick={loadFailures} className="btn-outline mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}
        {!loadingC && !failuresLoadError && failures.length === 0 && (
          <div className="text-center py-10 opacity-40 text-sm">
            <CheckCircle className="h-5 w-5 inline mr-2" />
            No unmatched payments - all clear.
          </div>
        )}
        {failures.map(f => (
          <div key={f.webhookLogId} className="p-4" style={{ border: "1px solid var(--color-table-border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{f.contactName ?? "-"}</p>
                {f.errorMessage && <p className="text-xs opacity-50 truncate" title={f.errorMessage}>{f.errorMessage}</p>}
                <p className="text-xs opacity-50 truncate">{f.contactEmail ?? "-"}</p>
                <p className="text-xs opacity-50">{f.contactPhone ?? "-"}</p>
              </div>
              <p className="font-semibold text-sm whitespace-nowrap" style={{ color: "var(--color-primary)" }}>
                {f.currency} {f.amount != null ? f.amount.toFixed(2) : "-"}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs opacity-60">
              <div>
                <span className="opacity-50">Received</span>
                <p>{formatDateTime(f.receivedAt)}</p>
              </div>
              <div>
                <span className="opacity-50">Retries</span>
                <p>{f.retryCount}</p>
              </div>
            </div>
            <p className="mt-3 font-mono text-xs opacity-50 truncate" title={f.gatewaySessionId}>
              {f.gatewaySessionId}
            </p>
            <button
              className="btn-outline mt-4 w-full px-3 py-2 text-xs font-semibold"
              onClick={() => {
                if (f.eventType === "charge.refunded") {
                  setReviewTarget(f);
                  setReviewNote("");
                } else {
                  setRefundTarget(f);
                  setRefundReason("");
                  setRefundNote("");
                  setRefundSource("System");
                  setRefundReference("");
                }
              }}
            >
              {f.eventType === "charge.refunded" ? "Mark Reviewed" : "Refund"}
            </button>
          </div>
        ))}
      </div>

      {/* ══════════ REFUND MODAL ══════════ */}
        </>
      )}

      {activeTab === "history" && (
        <div className="hidden md:block overflow-x-auto" style={{ border: "1px solid var(--color-table-border)" }}>
          <table className="trs-table">
            <thead>
              <tr>
                <th>Payer</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Refunded</th>
                <th>Reason</th>
                <th>Session ID</th>
                <th>Gateway Refund</th>
              </tr>
            </thead>
            <tbody>
              {loadingH && (
                <tr>
                  <td colSpan={7} className="text-center py-6">
                    <LoadingSpinner size="sm" label="Loading..." />
                  </td>
                </tr>
              )}
              {!loadingH && history.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 opacity-40">
                    <CheckCircle className="h-5 w-5 inline mr-2" />
                    No reconciliation refunds yet.
                  </td>
                </tr>
              )}
              {history.map(r => (
                <tr key={r.refundId}>
                  <td>
                    <p className="font-semibold text-sm">{r.contactName ?? "-"}</p>
                    <p className="text-xs opacity-50">{r.contactEmail ?? "-"}</p>
                  </td>
                  <td className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
                    {r.currency} {r.refundAmount.toFixed(2)}
                  </td>
                  <td><RefundStatusBadge status={r.refundStatus} /></td>
                  <td className="text-xs opacity-60 whitespace-nowrap">
                    {formatDateTime(r.processedAt ?? r.createdAt)}
                    <p className="opacity-50">{r.requestedBy ?? "admin"}</p>
                  </td>
                  <td className="text-xs max-w-[220px]">
                    <p className="truncate" title={r.refundReason ?? ""}>{r.refundReason ?? "-"}</p>
                  </td>
                  <td className="font-mono text-xs opacity-50 max-w-[180px] truncate" title={r.gatewaySessionId ?? ""}>
                    {r.gatewaySessionId ?? "-"}
                  </td>
                  <td className="font-mono text-xs opacity-50 max-w-[160px] truncate" title={r.gatewayRefundId ?? ""}>
                    {r.gatewayRefundId ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "history" && (
        <div className="md:hidden space-y-3">
          {loadingH && (
            <div className="text-center py-10">
              <LoadingSpinner size="sm" label="Loading..." />
            </div>
          )}
          {!loadingH && history.length === 0 && (
            <div className="text-center py-10 opacity-40 text-sm">
              <CheckCircle className="h-5 w-5 inline mr-2" />
              No reconciliation refunds yet.
            </div>
          )}
          {history.map(r => (
            <div key={r.refundId} className="p-4" style={{ border: "1px solid var(--color-table-border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{r.contactName ?? "-"}</p>
                  <p className="text-xs opacity-50 truncate">{r.contactEmail ?? "-"}</p>
                </div>
                <RefundStatusBadge status={r.refundStatus} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="font-semibold text-sm" style={{ color: "var(--color-primary)" }}>
                  {r.currency} {r.refundAmount.toFixed(2)}
                </p>
                <p className="text-xs opacity-60 text-right">
                  {formatDateTime(r.processedAt ?? r.createdAt)}
                  <span className="block opacity-50">{r.requestedBy ?? "admin"}</span>
                </p>
              </div>
              <p className="mt-3 text-xs opacity-70">{r.refundReason ?? "-"}</p>
              <div className="mt-3 space-y-1 font-mono text-xs opacity-50">
                <p className="truncate" title={r.gatewaySessionId ?? ""}>Session: {r.gatewaySessionId ?? "-"}</p>
                <p className="truncate" title={r.gatewayRefundId ?? ""}>Refund: {r.gatewayRefundId ?? "-"}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!reviewTarget} onOpenChange={v => { if (!v) setReviewTarget(null); }}>
        <DialogContent
          className="max-w-md p-0"
          style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}
        >
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Mark Refund Discrepancy Reviewed</DialogTitle>
            {reviewTarget && (
              <p className="text-xs opacity-50 mt-1 font-mono truncate" title={reviewTarget.gatewaySessionId}>
                {reviewTarget.gatewaySessionId}
              </p>
            )}
          </DialogHeader>

          {reviewTarget && (
            <div className="p-7 space-y-4">
              <div
                className="px-3 py-2 text-xs"
                style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}
              >
                This clears matching refund webhook discrepancy rows from Active. It does not issue or change any Stripe refund.
              </div>

              <FG label="Review note *">
                <textarea
                  className="field-input"
                  rows={3}
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  placeholder="e.g. Verified provider refund and matching system refund row; no further action required"
                />
              </FG>
            </div>
          )}

          <DialogFooter className="p-7 pt-0">
            <button onClick={() => setReviewTarget(null)} className="btn-outline px-5 py-2.5 text-sm">
              Cancel
            </button>
            <button
              onClick={handleMarkReviewed}
              disabled={!reviewNote.trim() || savingReview}
              className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {savingReview ? "Saving..." : "Mark Reviewed"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refundTarget} onOpenChange={v => { if (!v) { setRefundTarget(null); setRefundSource("System"); setRefundReference(""); } }}>
        <DialogContent
          className="max-w-md p-0"
          style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}
        >
          <DialogHeader className="p-7 pb-4" style={{ borderBottom: "1px solid var(--color-table-border)" }}>
            <DialogTitle className="font-bold text-lg">Refund Unmatched Payment</DialogTitle>
            {refundTarget && (
              <p className="text-xs mt-1">
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
                  <span>Name</span>
                  <span className="font-medium">{refundTarget.contactName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Email</span>
                  <span className="font-medium font-mono text-xs">{refundTarget.contactEmail ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phone</span>
                  <span className="font-medium">{refundTarget.contactPhone ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Amount</span>
                  <span className="font-bold" style={{ color: "var(--color-primary)" }}>
                    {refundTarget.currency} {refundTarget.amount?.toFixed(2)}
                  </span>
                </div>
              </div>

              <FG label="Refund mode">
                <select className="field-input" value={refundSource} onChange={e => setRefundSource(e.target.value as RefundSource)}>
                  <option value="System">Internal System Refund</option>
                  <option value="External">Record External Refund</option>
                </select>
              </FG>

              {refundSource === "External" && (
                <div className="space-y-3">
                  <div
                    className="px-3 py-2 text-xs"
                    style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}
                  >
                    This records a refund completed outside the system. It will not send money through the payment gateway.
                  </div>
                  <FG label="Refund method *">
                    <select className="field-input" value={refundMethod} onChange={e => setRefundMethod(e.target.value as RefundMethod)}>
                      {EXTERNAL_REFUND_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </FG>
                  <FG label={`Refund reference / ID${requiresRefundReference(refundMethod) ? " *" : " (optional)"}`}>
                    <input className="field-input" value={refundReference} onChange={e => setRefundReference(e.target.value)} />
                  </FG>
                </div>
              )}

              {refundSource === "System" && (
                <div
                  className="px-3 py-2 text-xs"
                  style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}
                >
                  This will issue a full refund through the system and record it. This action cannot be undone.
                </div>
              )}

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
              disabled={!refundReason.trim() || savingRefund || (refundSource === "External" && requiresRefundReference(refundMethod) && !refundReference.trim())}
              className="px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--badge-open-text)", color: "white" }}
            >
              {savingRefund ? "Processing..." : refundSource === "External" ? "Save" : "Execute Refund"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
