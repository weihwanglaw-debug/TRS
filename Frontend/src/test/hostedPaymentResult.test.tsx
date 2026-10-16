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
    vi.clearAllMocks(); sessionStorage.clear();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.mocked(apiRecoverHostedPaymentAttempt).mockResolvedValue({ data: null, error: { code: "UNKNOWN", message: "Unconfirmed" } });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const render = async () => {
    await act(async () => root.render(<MemoryRouter initialEntries={["/payment/result?gatewayReturn=1&attempt=12&event=34&status=success&reg=99&direct=paid"]}><PaymentResult /></MemoryRouter>));
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
    expect(container.textContent).toContain("Payment Status Not Confirmed");
    expect(container.textContent).not.toContain("Registration Confirmed!");
    expect(sessionStorage.getItem("trs_cart_34")).toBe("saved cart");
    expect(apiGetRegistration).not.toHaveBeenCalled();
  });
});
