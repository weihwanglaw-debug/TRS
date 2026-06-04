/**
 * PaymentResult.tsx
 *
 * Landing page after Stripe redirects back OR after free registration.
 *
 * ── SESSION-FIRST FLOW (PAID) ─────────────────────────────────────────────────
 * All registration data (cart, participants, contact person) is stored in
 * browser sessionStorage under key trs_cart_{eventId}. No DB record is created
 * before Stripe confirms payment.
 *
 * On SUCCESS (/payment/result?status=success&event={eventId}):
 *   1. Read gatewaySessionId + full payload from sessionStorage
 *   2. Call POST /api/registrations/confirm-session
 *      Backend: verifies payment with Stripe, writes Registration + Payment to DB,
 *      generates receipt, sends confirmation email, returns registrationId.
 *      If 409 (webhook already processed) → go directly to "processing" done state.
 *   3. Poll GET /api/registrations/:id until paymentStatus = "S"
 *   4. Clear sessionStorage, show receipt
 *
 * ── TIMING MODEL (per architecture spec) ─────────────────────────────────────
 * Stage A (0–15 s):  "Processing payment…"
 * Stage B (>15 s):   "Payment is processing. Confirmation will be sent via email."
 * Timeout is ONLY a UI concern — backend never marks a payment failed due to timeout.
 *
 * ── FREE REGISTRATION FLOW ───────────────────────────────────────────────────
 * Free registrations are written directly to the DB (no Stripe session).
 * The confirmation page is reached via:
 *   /payment/result?status=success&reg={registrationId}
 *
 * On FREE SUCCESS (/payment/result?status=success&reg={registrationId}):
 *   1. Detect: status=success + reg param present + no event param
 *   2. Skip confirm-session entirely — set regId directly
 *   3. Poll GET /api/registrations/:id until regStatus = "Confirmed"
 *      (paymentStatus stays "P" for free regs — never "S")
 *   4. Show receipt
 *
 * On CANCEL (/payment/result?status=cancel&event={eventId}):
 *   - No DB record was created — nothing to clean up
 *   - sessionStorage cart is intact
 *   - "Try Again" routes back to event page, cart auto-restores to Step 3
 *
 * Edge case — sessionStorage missing (different browser/device after payment):
 *   - confirm-session cannot be called without the payload
 *   - Show "processing" state — webhook may have already handled it
 *
 * Public page — no login required.
 */

import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, AlertCircle } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { motion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { apiConfirmSession, apiGetRegistration } from "@/lib/api";
import { API_BASE } from "@/lib/api/_base";
import type { Registration } from "@/lib/api";

type Phase = "confirming" | "polling" | "done" | "cancelled" | "error";

// Stage A → Stage B threshold in milliseconds (spec: 15 s)
const PROCESSING_STAGE_B_MS = 15_000;

export default function PaymentResult() {
  const [params]  = useSearchParams();
  const navigate  = useNavigate();
  const status    = params.get("status");
  const eventId   = params.get("event");
  const regParam  = params.get("reg");

  const isSuccess = status === "success";
  const isCancel  = status === "cancel" || status === "failed";

  // Free registration: status=success + reg param present + no event param
  const isFreeReg = isSuccess && !!regParam && !eventId;

  const initialPhase: Phase = isSuccess ? "confirming" : isCancel ? "cancelled" : "done";

  const [phase,        setPhase]        = useState<Phase>(initialPhase);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [regId,        setRegId]        = useState<string | null>(null);
  const [errorMsg,     setErrorMsg]     = useState("");
  const [pollCount,    setPollCount]    = useState(0);
  // Stage A/B: tracks whether we've passed the 15-second processing threshold
  const [stageBActive, setStageBActive] = useState(false);
  const startTimeRef = useRef<number>(Date.now());

  // ── Stage B timer — fires after PROCESSING_STAGE_B_MS ───────────────────
  useEffect(() => {
    if (phase !== "confirming" && phase !== "polling") return;
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, PROCESSING_STAGE_B_MS - elapsed);
    const timer = setTimeout(() => setStageBActive(true), remaining);
    return () => clearTimeout(timer);
  }, [phase]);

  // ── On success: handle paid flow (confirm-session) OR free flow ──────────
  useEffect(() => {
    if (!isSuccess) return;

    // ── FREE REGISTRATION: reg param present, no event param ─────────────────
    if (isFreeReg) {
      // Registration already exists in DB — skip confirm-session entirely
      setRegId(regParam);
      setPhase("polling");
      return;
    }

    // ── PAID REGISTRATION: event param drives session key ────────────────────
    const SESSION_KEY = eventId ? `trs_cart_${eventId}` : null;

    if (!SESSION_KEY) {
      setPhase("error");
      setErrorMsg("Missing event context. If your payment was successful you will receive a confirmation email. Otherwise please contact the organiser.");
      return;
    }

    let raw: string | null = null;
    try { raw = sessionStorage.getItem(SESSION_KEY); } catch { /* private mode */ }

    if (!raw) {
      // Different browser/device or cleared storage — cannot confirm but payment
      // may have been processed by the webhook. Show processing state, not error.
      setPhase("done");
      return;
    }

    let session: { gatewaySessionId?: string; payload?: object } = {};
    try { session = JSON.parse(raw); } catch {
      setPhase("error");
      setErrorMsg("Session data could not be read. Please contact the organiser.");
      return;
    }

    if (!session.gatewaySessionId || !session.payload) {
      setPhase("error");
      setErrorMsg("Incomplete session data. Please contact the organiser.");
      return;
    }

    const gatewaySessionId = session.gatewaySessionId;

    // Call backend to verify with Stripe and write to DB
    apiConfirmSession(gatewaySessionId, session.payload).then(r => {
      // Clear session storage regardless of outcome — data is either in DB already
      // (webhook processed it) or being written now.
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }

      if (r.error) {
        // Network timeouts and Stripe slow responses are NOT failures —
        // the webhook will complete the registration.
        // Only show hard error for CONFIRM_FAILED where we are certain
        // the payment itself did not go through.
        const isDefiniteFailure = r.error.code === "CONFIRM_FAILED"
          && r.error.message.toLowerCase().includes("not been confirmed");
        if (isDefiniteFailure) {
          setPhase("error");
          setErrorMsg(r.error.message);
        } else {
          // Treat all other errors (network timeout, Stripe slow, etc.)
          // as "still processing" — webhook will complete shortly.
          setPhase("done");
        }
        return;
      }

      // 409 / alreadyProcessed = webhook already finalised this session before
      // the browser returned. Registration is in DB — show processing state.
      if (r.data!.alreadyProcessed) {
        setPhase("done");
        return;
      }

      setRegId(r.data!.registrationId);
      setPhase("polling");
    });
  }, []); // run once on mount

  // ── Poll until registration is confirmed ──────────────────────────────────
  // Resolves when:
  //   - Paid:  paymentStatus === "S"
  //   - Free:  regStatus === "Confirmed" (paymentStatus stays "P")
  // After MAX_ATTEMPTS we stop polling and show the "still processing" state —
  // this is NOT a failure; the webhook will complete the registration shortly.
  useEffect(() => {
    if (phase !== "polling" || !regId) return;

    let cancelled = false;
    let attempts  = 0;
    const MAX_ATTEMPTS = 10;

    const poll = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const r = await apiGetRegistration(regId);
        if (cancelled) return;
        if (r.data) {
          setRegistration(r.data);

          const paidSuccess  = r.data.payment.paymentStatus === "S";
          const freeConfirmed =
            r.data.regStatus === "Confirmed" &&
            r.data.payment.paymentStatus === "P";

          if (paidSuccess || freeConfirmed || attempts >= MAX_ATTEMPTS) {
            setPhase("done");
            return;
          }
        }
      } catch { /* keep polling */ }

      if (attempts < MAX_ATTEMPTS) {
        setPollCount(attempts);
        setTimeout(poll, 1500);
      } else {
        // Polling exhausted — not a failure. Webhook will complete shortly.
        setPhase("done");
      }
    };

    setTimeout(poll, 800);
    return () => { cancelled = true; };
  }, [phase, regId]);

  // Confirmed when paid AND succeeded, OR free AND status is Confirmed
  const isConfirmed =
    registration?.payment.paymentStatus === "S" ||
    (registration?.regStatus === "Confirmed" &&
      registration?.payment.paymentStatus === "P");

  const receiptNo = registration?.payment.receiptNo ?? (regId ? `TRS-${regId}` : "—");

  const handleTryAgain = () => {
    if (eventId) navigate(`/event/${eventId}`);
    else navigate("/");
  };

  // ── Stage A / Stage B processing message ─────────────────────────────────
  const processingMessage = stageBActive
    ? "Payment is processing. You will receive a confirmation email shortly. Do not retry payment."
    : (phase === "confirming" ? "Verifying your payment…" : "Finalising your registration…");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 pt-16 flex items-center justify-center px-8"
        style={{ backgroundColor: "var(--color-page-bg)" }}>
        <motion.div className="max-w-md w-full text-center py-20"
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>

          {/* Stage A / Stage B processing spinner */}
          {(phase === "confirming" || phase === "polling") && (
            <>
              <Loader2 className="h-12 w-12 mx-auto mb-5 animate-spin opacity-40" />
              <p className="text-sm opacity-50 mb-1">{processingMessage}</p>
              {stageBActive && (
                <p className="text-xs opacity-30 mt-2">You can safely close this page.</p>
              )}
            </>
          )}

          {/* Success — confirmed */}
          {phase === "done" && isConfirmed && (
            <>
              <CheckCircle className="h-16 w-16 mx-auto mb-5" style={{ color: "var(--color-primary)" }} />
              <h1 className="font-heading font-bold text-2xl mb-3">Registration Confirmed!</h1>
              <p className="text-sm opacity-70 mb-2">
                Receipt No: <span className="font-mono font-semibold">{receiptNo}</span>
              </p>
              {registration && (
                <p className="text-xs opacity-50 mb-1">
                  {registration.groups.map(g => g.programName).join(" · ")}
                </p>
              )}
              <p className="text-sm opacity-60 mb-8">
                A confirmation email has been sent to your registered contact email.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  className="btn-primary px-6 py-2.5 text-sm font-semibold"
                  onClick={() => window.open(`${API_BASE}/api/registrations/${regId}/receipt`, "_blank")}>
                  Download Receipt
                </button>
                <button onClick={() => navigate("/")} className="btn-outline px-6 py-2.5 text-sm font-medium">
                  Back to Home
                </button>
              </div>
            </>
          )}

          {/* Done but still pending (webhook slow / alreadyProcessed / no session storage) */}
          {phase === "done" && !isConfirmed && !errorMsg && (
            <>
              <Loader2 className="h-12 w-12 mx-auto mb-5 opacity-40" />
              <h1 className="font-heading font-bold text-2xl mb-3">Payment Processing</h1>
              <p className="text-sm opacity-60 mb-8">
                Your payment is being processed. If successful, you will receive
                a confirmation email shortly. You can safely close this page.
              </p>
              <button onClick={() => navigate("/")} className="btn-outline px-6 py-2.5 text-sm font-medium">
                Back to Home
              </button>
            </>
          )}

          {/* Hard error during confirm (non-recoverable, not a timeout) */}
          {phase === "error" && (
            <>
              <AlertCircle className="h-16 w-16 mx-auto mb-5 opacity-70" style={{ color: "var(--badge-soon-text)" }} />
              <h1 className="font-heading font-bold text-2xl mb-3">Something Went Wrong</h1>
              <p className="text-sm opacity-70 mb-8">{errorMsg}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {eventId && (
                  <button onClick={handleTryAgain} className="btn-primary px-6 py-2.5 text-sm font-semibold">
                    Try Again
                  </button>
                )}
                <button onClick={() => navigate("/")} className="btn-outline px-6 py-2.5 text-sm font-medium">
                  Back to Home
                </button>
              </div>
            </>
          )}

          {/* Cancelled */}
          {phase === "cancelled" && (
            <>
              <XCircle className="h-16 w-16 mx-auto mb-5" style={{ color: "var(--badge-open-text)" }} />
              <h1 className="font-heading font-bold text-2xl mb-3">Payment Cancelled</h1>
              <p className="text-sm opacity-70 mb-8">
                No payment was taken and nothing has been saved.
                Your registration details are preserved — click Try Again to continue.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={handleTryAgain} className="btn-primary px-6 py-2.5 text-sm font-semibold">
                  Try Again
                </button>
                <button onClick={() => navigate("/")} className="btn-outline px-6 py-2.5 text-sm font-medium">
                  Back to Home
                </button>
              </div>
            </>
          )}

        </motion.div>
      </main>
      <Footer />
    </div>
  );
}