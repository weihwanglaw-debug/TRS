import { useEffect, useMemo, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, StripeElementsOptions } from "@stripe/stripe-js";
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  apiGetEmbeddedPaymentAttemptStatus,
  apiSubmitEmbeddedPaymentAttempt,
} from "@/lib/api";
import type { EmbeddedPaymentAttempt } from "@/types/registration";

type PaymentSummaryItem = {
  label: string;
  amount: number;
  detail?: string;
};

export type PaymentModalPhase = "ready" | "submitting" | "waiting" | "success" | "failed" | "expired" | "review";

type EmbeddedPaymentModalProps = {
  open: boolean;
  attempt: EmbeddedPaymentAttempt | null;
  paymentMethod: "card" | "paynow";
  summaryItems: PaymentSummaryItem[];
  onClose: (phase?: PaymentModalPhase) => void;
  onConfirmed: (registrationId: string) => void;
};

type EmbeddedPaymentBodyProps = EmbeddedPaymentModalProps & {
  onCloseLockChange: (locked: boolean) => void;
  onPhaseChange: (phase: PaymentModalPhase) => void;
};

const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();

function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache.has(publishableKey)) {
    stripePromiseCache.set(publishableKey, loadStripe(publishableKey));
  }
  return stripePromiseCache.get(publishableKey)!;
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
  }).format(amount);
}

function secondsLeft(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

const PAYMENT_OPEN_PATIENCE_MS = 20000;
const STRIPE_LOAD_TIMEOUT_MS = 10000;
const PAYMENT_STATUS_POLL_FAILURE_LIMIT = 5;

function readThemeColor(name: string) {
  if (typeof window === "undefined") return "currentColor";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "currentColor";
}

function isTerminalPhase(phase: PaymentModalPhase) {
  return phase === "success" || phase === "failed" || phase === "expired" || phase === "review";
}

export default function EmbeddedPaymentModal(props: EmbeddedPaymentModalProps) {
  const { open, attempt } = props;
  const [closeLocked, setCloseLocked] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<PaymentModalPhase>("ready");
  const stripePromise = useMemo(
    () => attempt ? getStripePromise(attempt.publishableKey) : null,
    [attempt?.publishableKey],
  );

  const options = useMemo<StripeElementsOptions | undefined>(() => {
    if (!attempt) return undefined;
    return {
      clientSecret: attempt.clientSecret,
      appearance: {
        theme: "stripe",
        variables: {
          colorPrimary: readThemeColor("--payment-provider-primary"),
          borderRadius: "2px",
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
    };
  }, [attempt]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (closeLocked) return;
        props.onClose(currentPhase);
      }}
    >
      <DialogContent
        className="max-w-3xl p-0 overflow-hidden"
        style={{ backgroundColor: "var(--color-page-bg)", border: "1px solid var(--color-table-border)" }}
        onEscapeKeyDown={(event) => {
          if (closeLocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (closeLocked) event.preventDefault();
        }}
      >
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="font-bold text-xl">Complete Payment</DialogTitle>
        </DialogHeader>
        {attempt && stripePromise && options ? (
          <Elements stripe={stripePromise} options={options}>
            <EmbeddedPaymentBody
              {...props}
              onCloseLockChange={setCloseLocked}
              onPhaseChange={setCurrentPhase}
            />
          </Elements>
        ) : (
          <div className="p-8 text-sm opacity-70">Preparing payment...</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmbeddedPaymentBody({
  attempt,
  paymentMethod,
  summaryItems,
  onClose,
  onConfirmed,
  onCloseLockChange,
  onPhaseChange,
}: EmbeddedPaymentBodyProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [phase, setPhase] = useState<PaymentModalPhase>("ready");
  const [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState(attempt ? secondsLeft(attempt.expiresAt) : 0);
  const [confirmedRegistrationId, setConfirmedRegistrationId] = useState<string | null>(null);
  const [patienceReached, setPatienceReached] = useState(false);
  const [stripeLoadTimedOut, setStripeLoadTimedOut] = useState(false);
  const settledRef = useRef(false);
  const mountedRef = useRef(true);
  const pollFailureCountRef = useRef(0);

  const submitted = phase === "submitting" || phase === "waiting" || phase === "success" || phase === "review";
  const controlsDisabled = phase === "submitting" || phase === "waiting" || phase === "success" || phase === "review";
  const total = summaryItems.reduce((sum, item) => sum + item.amount, 0);

  const setNonTerminalPhase = (nextPhase: PaymentModalPhase, nextMessage?: string) => {
    if (!mountedRef.current || settledRef.current) return false;
    setPhase(nextPhase);
    if (nextMessage !== undefined) setMessage(nextMessage);
    return true;
  };

  const setTerminalPhase = (nextPhase: PaymentModalPhase, nextMessage: string) => {
    if (!mountedRef.current || settledRef.current) return false;
    settledRef.current = true;
    setPhase(nextPhase);
    setMessage(nextMessage);
    return true;
  };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    settledRef.current = false;
    pollFailureCountRef.current = 0;
    setStripeLoadTimedOut(false);
  }, [attempt?.paymentAttemptId]);

  useEffect(() => {
    if (isTerminalPhase(phase)) settledRef.current = true;
  }, [phase]);

  useEffect(() => {
    onPhaseChange(phase);
    onCloseLockChange((phase === "submitting" || phase === "waiting") && !patienceReached);
  }, [onCloseLockChange, onPhaseChange, patienceReached, phase]);

  useEffect(() => {
    if (!attempt || submitted) return;
    const timer = window.setInterval(() => {
      const left = secondsLeft(attempt.expiresAt);
      setRemaining(left);
      if (left <= 0) {
        setTerminalPhase("expired", "Payment session has expired. Please close this window and try again.");
        window.clearInterval(timer);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt?.expiresAt, submitted]);

  useEffect(() => {
    if (phase !== "ready" || stripeLoadTimedOut || (stripe && elements)) return;
    const timer = window.setTimeout(() => {
      if (!stripe || !elements) setStripeLoadTimedOut(true);
    }, STRIPE_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [elements, phase, stripe, stripeLoadTimedOut]);

  useEffect(() => {
    if (stripe && elements) setStripeLoadTimedOut(false);
  }, [elements, stripe]);

  useEffect(() => {
    if (!attempt || (phase !== "waiting" && phase !== "submitting")) return;
    const patienceTimer = window.setTimeout(
      () => setPatienceReached(true),
      phase === "submitting" ? PAYMENT_OPEN_PATIENCE_MS : 30000,
    );
    const pollTimer = window.setInterval(async () => {
      let status;
      try {
        status = await apiGetEmbeddedPaymentAttemptStatus(attempt.paymentAttemptId);
      } catch {
        status = { error: { code: "NETWORK_ERROR", message: "Payment status check failed." }, data: undefined };
      }

      if (settledRef.current) {
        window.clearInterval(pollTimer);
        return;
      }

      if (status.error || !status.data) {
        pollFailureCountRef.current += 1;
        if (pollFailureCountRef.current >= PAYMENT_STATUS_POLL_FAILURE_LIMIT) {
          setTerminalPhase(
            "review",
            "We're having trouble checking your payment status. If you approved payment, please do not pay again. Contact the organiser with the reference below.",
          );
          window.clearInterval(pollTimer);
        }
        return;
      }

      pollFailureCountRef.current = 0;

      if (status.data.status === "S" && status.data.registrationId) {
        setConfirmedRegistrationId(String(status.data.registrationId));
        setTerminalPhase("success", "Your registration has been confirmed.");
        window.clearInterval(pollTimer);
        return;
      }

      if (status.data.status === "F" || status.data.status === "X") {
        setTerminalPhase("failed", status.data.errorMessage || "Payment was not completed. Your cart has been kept.");
        window.clearInterval(pollTimer);
        return;
      }

      if (status.data.status === "EX") {
        setTerminalPhase("expired", "Payment session has expired. Your cart has been kept.");
        window.clearInterval(pollTimer);
        return;
      }

      if (status.data.status === "NR") {
        setTerminalPhase("review", status.data.errorMessage || "Payment needs organiser review. Please do not pay again if payment was deducted.");
        window.clearInterval(pollTimer);
      }
    }, 3000);
    return () => {
      window.clearTimeout(patienceTimer);
      window.clearInterval(pollTimer);
    };
  }, [attempt?.paymentAttemptId, phase]);

  if (!attempt) return null;

  const handlePay = async () => {
    if (!stripe || !elements || controlsDisabled || phase === "expired") return;
    setNonTerminalPhase("submitting", paymentMethod === "paynow"
      ? "Opening PayNow QR code..."
      : "Opening secure card payment...");
    setPatienceReached(false);

    try {
      const elementSubmit = await elements.submit();
      if (settledRef.current) return;
      if (elementSubmit.error) {
        setTerminalPhase("failed", elementSubmit.error.message || "Payment details are incomplete. Please check and try again.");
        return;
      }

      const submittedResult = await apiSubmitEmbeddedPaymentAttempt(attempt.paymentAttemptId);
      if (settledRef.current) return;
      if (submittedResult.error) {
        setTerminalPhase("failed", submittedResult.error.message);
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: window.location.href,
        },
      });

      if (settledRef.current) return;
      if (result.error) {
        setTerminalPhase("failed", result.error.message || "Payment was not completed. Your cart has been kept.");
        return;
      }

      setNonTerminalPhase("waiting", paymentMethod === "paynow"
        ? "Waiting for PayNow confirmation..."
        : "Finalising your registration...");
    } catch {
      setTerminalPhase(
        "failed",
        "We couldn't reach the payment server. Please check your connection and try again. Your cart has been kept.",
      );
    }
  };

  const closeAfterSuccess = () => {
    if (confirmedRegistrationId) onConfirmed(confirmedRegistrationId);
  };

  const statusPanel = (() => {
    if (phase === "success") {
      return (
        <div className="p-4 flex gap-3" style={{ backgroundColor: "var(--badge-open-bg)", color: "var(--badge-open-text)" }}>
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Payment successful.</p>
            <p className="text-sm opacity-80">{message}</p>
          </div>
        </div>
      );
    }
    if (phase === "failed" || phase === "expired") {
      return (
        <div className="p-4 flex gap-3" style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
          <XCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{phase === "expired" ? "Payment session expired." : "Payment not completed."}</p>
            <p className="text-sm opacity-80">
              {message} Please close this window and start payment again. Your cart will be kept.
            </p>
          </div>
        </div>
      );
    }
    if (phase === "review") {
      return (
        <div className="p-4 flex gap-3" style={{ backgroundColor: "var(--badge-soon-bg)", color: "var(--badge-soon-text)" }}>
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Organiser review required.</p>
            <p className="text-sm opacity-80">{message}</p>
            <p className="text-xs mt-2 opacity-70">Reference: {attempt.paymentIntentId}</p>
          </div>
        </div>
      );
    }
    if (stripeLoadTimedOut && phase === "ready") {
      return (
        <div className="p-4 flex gap-3" style={{ backgroundColor: "var(--badge-closed-bg)", color: "var(--badge-closed-text)" }}>
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Payment form failed to load.</p>
            <p className="text-sm opacity-80">This can happen with ad blockers or a slow connection. Please refresh and try again.</p>
          </div>
        </div>
      );
    }
    if (patienceReached) {
      return (
        <div className="p-4 flex gap-3" style={{ backgroundColor: "var(--color-row-hover)", color: "var(--color-body-text)" }}>
          <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
          <div>
            <p className="font-semibold">{phase === "submitting" ? "Payment screen is taking longer than expected." : "Still confirming."}</p>
            <p className="text-sm opacity-70">
              {phase === "submitting"
                ? "If the payment screen has not appeared, close this window and try again. Your cart will be kept."
                : paymentMethod === "paynow"
                ? "If you have not approved payment in your banking app, close this window and start again. If you have approved it, please do not pay again."
                : "Please keep this window open. If payment was completed, please do not pay again."}
            </p>
          </div>
        </div>
      );
    }
    if (phase === "submitting" || phase === "waiting") {
      return (
        <div className="p-4 flex gap-3" style={{ backgroundColor: "var(--color-row-hover)", color: "var(--color-body-text)" }}>
          <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
          <div>
            <p className="font-semibold">{phase === "submitting" ? "Submitting payment..." : message}</p>
            <p className="text-sm opacity-70">Please keep this window open while we confirm your registration.</p>
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="grid md:grid-cols-[1fr_1.1fr] gap-0">
      <aside className="p-6 border-t md:border-t-0 md:border-r" style={{ borderColor: "var(--color-table-border)" }}>
        <p className="text-xs font-semibold opacity-60 mb-3">Registration Summary</p>
        <div className="space-y-3">
          {summaryItems.map((item, idx) => (
            <div key={`${item.label}-${idx}`} className="flex justify-between gap-4 text-sm">
              <div>
                <p className="font-semibold">{item.label}</p>
                {item.detail && <p className="text-xs opacity-55">{item.detail}</p>}
              </div>
              <span className="font-semibold">{formatMoney(item.amount, attempt.currency)}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 flex justify-between text-base font-bold" style={{ borderTop: "1px solid var(--color-table-border)" }}>
          <span>Total</span>
          <span>{formatMoney(total, attempt.currency)}</span>
        </div>
        <div className="mt-5 text-sm">
          <p className="text-xs font-semibold opacity-60">Payment Method</p>
          <p className="font-semibold mt-1">{paymentMethod === "paynow" ? "PayNow" : "Credit / Debit Card"}</p>
        </div>
        {!submitted && phase !== "expired" && (
          <div className="mt-5 p-3 text-center" style={{ backgroundColor: "var(--color-row-hover)" }}>
            <p className="text-xs opacity-60">Time remaining</p>
            <p className="text-lg font-bold tabular-nums">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</p>
          </div>
        )}
      </aside>
      <section className="p-6 space-y-5">
        {statusPanel}
        {(phase === "ready" || phase === "submitting") && (
          <div className={`space-y-4 ${phase === "submitting" ? "pointer-events-none opacity-60" : ""}`}>
            <PaymentElement
              options={{
                layout: "tabs",
                wallets: {
                  link: "never",
                },
              }}
            />
            <button
              type="button"
              className="btn-primary w-full py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!stripe || !elements || controlsDisabled}
              onClick={handlePay}
            >
              Pay {formatMoney(attempt.amount, attempt.currency)}
            </button>
          </div>
        )}
        {phase === "success" && (
          <button type="button" className="btn-primary w-full py-3 font-semibold" onClick={closeAfterSuccess}>
            Close
          </button>
        )}
        {(phase === "expired" || phase === "failed" || phase === "review" || ((phase === "submitting" || phase === "waiting") && patienceReached)) && (
          <button type="button" className="btn-outline w-full py-3 font-semibold" onClick={() => onClose(phase)}>
            Close
          </button>
        )}
      </section>
    </div>
  );
}
