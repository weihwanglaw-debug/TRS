import { apiSubmitEmbeddedPaymentAttempt } from "@/lib/api/registrationsApi";
import type { EmbeddedPaymentAttempt } from "@/types/registration";

export const hostedAttemptStorageKey = (id: number) => `trs_hosted_attempt_${id}`;

export function readHostedAttemptKey(id: number): string | null {
  try {
    const key = sessionStorage.getItem(hostedAttemptStorageKey(id));
    return key && key.length >= 32 && key.length <= 120 ? key : null;
  } catch { return null; }
}

export function prepareHostedCheckout(attempt: EmbeddedPaymentAttempt): HTMLFormElement {
  const checkout = attempt.hostedCheckout;
  const sandboxUrl = /^https:\/\/sandbox-payment\.fiuu\.com\/RMS\/pay\/SB_[A-Za-z0-9_]+\/$/;
  const productionUrl = /^https:\/\/pay\.fiuu\.com\/RMS\/pay\/(?!SB_)[A-Za-z0-9_]{1,32}\/$/;
  if (attempt.checkoutMode !== "hosted" || !checkout
    || !(sandboxUrl.test(checkout.url) || productionUrl.test(checkout.url))) {
    throw new Error("The secure payment page is unavailable.");
  }
  // Save before marking submitted or navigating. The secret is never placed in a URL or sent to Fiuu.
  sessionStorage.setItem(hostedAttemptStorageKey(attempt.paymentAttemptId), attempt.attemptKey);
  if (readHostedAttemptKey(attempt.paymentAttemptId) !== attempt.attemptKey)
    throw new Error("Please enable browser storage before continuing to payment.");
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkout.url;
  form.target = "_self";
  form.acceptCharset = "UTF-8";
  form.hidden = true;
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  return form;
}

export class HostedCheckoutError extends Error {
  constructor(message: string, public readonly uncertain: boolean) { super(message); }
}

export async function submitHostedCheckout(attempt: EmbeddedPaymentAttempt): Promise<void> {
  let form: HTMLFormElement | undefined;
  let marked = false;
  try {
    if (!Number.isFinite(Date.parse(attempt.expiresAt)) || Date.parse(attempt.expiresAt) <= Date.now())
      throw new Error("This payment session has expired. Please try again.");
    form = prepareHostedCheckout(attempt);
    marked = true;
    const result = await apiSubmitEmbeddedPaymentAttempt(attempt.paymentAttemptId, attempt.attemptKey);
    if (result.error) throw new Error(result.error.message);
    document.body.appendChild(form);
    HTMLFormElement.prototype.submit.call(form);
  } catch (error) {
    throw new HostedCheckoutError(marked
      ? "We could not open or confirm the payment session. Check its status before trying another payment."
      : error instanceof Error ? error.message : "Unable to open the payment page.", marked);
  } finally { form?.remove(); }
}
