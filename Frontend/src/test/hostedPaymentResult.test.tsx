import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaymentResult from "@/pages/PaymentResult";
import { apiConfirmSession, apiGetRegistration, apiGetEmbeddedPaymentAttemptStatus, apiRecoverHostedPaymentAttempt } from "@/lib/api";
import { hostedAttemptStorageKey } from "@/lib/hostedCheckout";

vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/components/layout/Footer", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({ apiConfirmSession: vi.fn(), apiGetRegistration: vi.fn(), apiGetEmbeddedPaymentAttemptStatus: vi.fn(), apiRecoverHostedPaymentAttempt: vi.fn() }));

describe("hosted payment return", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.resetAllMocks(); sessionStorage.clear();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.mocked(apiRecoverHostedPaymentAttempt).mockResolvedValue({ data: null, error: { code: "UNKNOWN", message: "Unconfirmed" } });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
  const render = async (url = "/payment/result?gatewayReturn=1&attempt=12&event=34&status=success&reg=99&direct=paid") => {
    await act(async () => root.render(<MemoryRouter initialEntries={[url]}><PaymentResult /></MemoryRouter>));
  };
  it("does not trust success and registration IDs in a return URL without the saved key", async () => {
    await render();
    expect(container.textContent).toContain("Payment Status Not Confirmed");
    expect(apiGetRegistration).not.toHaveBeenCalled();
    expect(apiConfirmSession).not.toHaveBeenCalled();
    expect(apiRecoverHostedPaymentAttempt).not.toHaveBeenCalled();
  });
  it("shows confirmation only after the protected status API confirms registration", async () => {
    sessionStorage.setItem(hostedAttemptStorageKey(12), "a".repeat(64));
    sessionStorage.setItem("trs_cart_34", "saved cart");
    vi.mocked(apiGetEmbeddedPaymentAttemptStatus).mockResolvedValue({ data: { paymentAttemptId: 12, eventId: 34, status: "S", registrationId: 99, paymentId: 5, expiresAt: "", reconciliationReason: null, errorMessage: null }, error: null });
    vi.mocked(apiGetRegistration).mockResolvedValue({ data: { id: "99", payment: { paymentStatus: "S", receiptNo: "TEST-99" }, groups: [] } as never, error: null });
    await render();
    expect(container.textContent).toContain("Registration Confirmed!");
    expect(apiGetEmbeddedPaymentAttemptStatus).toHaveBeenCalledWith(12, "a".repeat(64));
    expect(sessionStorage.getItem("trs_cart_34")).toBeNull();
    expect(sessionStorage.getItem(hostedAttemptStorageKey(12))).toBe("a".repeat(64));
    expect(apiConfirmSession).not.toHaveBeenCalled();
  });
  it("keeps the cart and displays review when the server reports reconciliation", async () => {
    sessionStorage.setItem(hostedAttemptStorageKey(12), "a".repeat(64));
    sessionStorage.setItem("trs_cart_34", "saved cart");
    vi.mocked(apiGetEmbeddedPaymentAttemptStatus).mockResolvedValue({ data: { paymentAttemptId: 12, status: "NR", registrationId: null, paymentId: null, expiresAt: "", reconciliationReason: "LATE_PAYMENT", errorMessage: "Payment requires review." }, error: null });
    await render();
    expect(container.textContent).toContain("Payment Requires Review");
    expect(container.textContent).not.toContain("Registration Confirmed!");
    expect(sessionStorage.getItem("trs_cart_34")).toBe("saved cart");
    expect(apiGetRegistration).not.toHaveBeenCalled();
  });
  it.each([["F", "Payment Not Completed"], ["X", "Payment Cancelled"], ["EX", "Checkout Expired"]])(
    "shows protected server outcome %s accurately", async (status, title) => {
      sessionStorage.setItem(hostedAttemptStorageKey(12), "a".repeat(64));
      sessionStorage.setItem("trs_cart_34", "saved cart");
      vi.mocked(apiGetEmbeddedPaymentAttemptStatus).mockResolvedValue({ data: {
        paymentAttemptId: 12, status, registrationId: null, paymentId: null,
        expiresAt: "", reconciliationReason: null, errorMessage: null,
      } as never, error: null });
      await render();
      expect(container.textContent).toContain(title);
      expect(container.textContent).not.toContain("Registration Confirmed!");
      expect(sessionStorage.getItem("trs_cart_34")).toBe("saved cart");
      if (status === "EX") expect(container.textContent).toContain("before making another payment");
      else expect(container.textContent).toContain("return to the event to try again");
    });

  it.each(["pending", "network"])("keeps %s recovery uncertain through polling timeout", async kind => {
    vi.useFakeTimers();
    sessionStorage.setItem(hostedAttemptStorageKey(12), "a".repeat(64));
    vi.mocked(apiRecoverHostedPaymentAttempt).mockRejectedValue(new Error("offline"));
    if (kind === "network") vi.mocked(apiGetEmbeddedPaymentAttemptStatus).mockRejectedValue(new Error("offline"));
    else vi.mocked(apiGetEmbeddedPaymentAttemptStatus).mockResolvedValue({data: {status: "SUB"} as never, error: null});
    await render();
    expect(container.textContent).toContain("Checking your payment status");
    await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
    expect(container.textContent).not.toContain("confirmation email shortly");
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(container.textContent).toContain("Payment Status Not Confirmed");
    expect(container.textContent).toContain("TRS attempt 12");
    expect(container.textContent).not.toContain("Payment Cancelled");
  });

  it.each(["cancel", "failed"])("does not claim Stripe %s URL proves no charge or deleted registration", async status => {
    await render("/payment/result?status=" + status + "&reg=99");
    expect(container.textContent).toContain("Checkout Returned Without Confirmation");
    expect(container.textContent).not.toContain("No payment was taken");
    expect(container.textContent).not.toContain("nothing has been saved");
    expect(container.textContent).not.toContain("Try Again");
    expect(apiConfirmSession).not.toHaveBeenCalled();
  });

  it("restores embedded Stripe success on refresh from the registration API", async () => {
    vi.mocked(apiGetRegistration).mockResolvedValue({ data: {
      id: "99", payment: {paymentStatus: "S", receiptNo: "TEST-99"}, groups: [],
    } as never, error: null });
    await render("/payment/result?status=success&reg=99&direct=paid");
    expect(container.textContent).toContain("Registration Confirmed!");
    expect(apiGetRegistration).toHaveBeenCalledWith("99");
    expect(apiRecoverHostedPaymentAttempt).not.toHaveBeenCalled();
  });

  it("confirms legacy Stripe success through its own session API", async () => {
    sessionStorage.setItem("trs_cart_34", JSON.stringify({gatewaySessionId:"cs_test", payload:{}}));
    vi.mocked(apiConfirmSession).mockResolvedValue({data:{alreadyProcessed:true} as never,error:null});
    await render("/payment/result?status=success&event=34");
    expect(apiConfirmSession).toHaveBeenCalledWith("cs_test", {});
    expect(container.textContent).toContain("Payment Status Not Confirmed");
    expect(container.textContent).not.toContain("confirmation email shortly");
  });

});
