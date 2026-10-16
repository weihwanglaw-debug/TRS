import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { submitHostedCheckout } from "@/lib/hostedCheckout";
import EventDetail from "@/pages/EventDetail";
import { apiGetEvent, apiGetPaymentMethods, apiCreateEmbeddedPaymentAttempt } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiGetEvent: vi.fn(), apiGetPaymentMethods: vi.fn(), apiCreateEmbeddedPaymentAttempt: vi.fn(), assetUrl: (v: string) => v }));
vi.mock("@/lib/hostedCheckout", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/hostedCheckout")>(), submitHostedCheckout: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock("@/contexts/LiveConfigContext", () => ({ useLiveConfig: () => ({ cfg: { currency: "SGD", consentText: "I agree" } }) }));
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/components/layout/Footer", () => ({ default: () => null }));
vi.mock("@/components/registration/EmbeddedPaymentModal", () => ({ default: ({ open }: { open: boolean }) => open ? <div>Stripe payment modal</div> : null }));
vi.mock("@/lib/eventUtils", () => ({
  getEventStatus: () => "O", formatDate: () => "Test date", getCartProgramCapacityUsage: () => 0,
  getProgramRegistrationPresentation: () => ({ canRegister: true, badgeStatus: "O" }),
}));

describe("gateway-aware registration payment choices", () => {
  let client: QueryClient;
  let root: Root;
  let container: HTMLDivElement;
  function button(pattern: RegExp) {
    const found = [...container.querySelectorAll("button")].find(b => pattern.test(b.textContent ?? ""));
    if (!found) throw new Error("Button not rendered: " + pattern);
    return found;
  }
  async function waitFor(check: () => void) {
    for (let i = 0; i < 50; i++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      try { check(); return; } catch (error) { if (i === 49) throw error; }
    }
  }
  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    sessionStorage.setItem("trs_cart_1", JSON.stringify({
      cart: [{ programId: "2", programName: "Test", fee: 10, feeStructure: "per_entry", participants: [] }],
      contact: { name: "Tester", email: "test@example.com", phone: "+6591234567" },
    }));
    vi.mocked(apiGetEvent).mockResolvedValue({ data: {
      id: "1", name: "Test event", programs: [{ id: "2", name: "Test", paymentRequired: true, fee: 10, currentParticipants: 0 }],
    } as never, error: null });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
  function show() {
    act(() => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/events/1"]}>
      <Routes><Route path="/events/:id" element={<EventDetail />} /></Routes>
    </MemoryRouter></QueryClientProvider>));
  }
  it("disables unconfigured cards and selects PayNow", async () => {
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Fiuu", methods: ["paynow"] }, error: null });
    show();
    await waitFor(() => expect(button(/Credit \/ Debit Card/)).toBeDisabled());
    await waitFor(() => expect(button(/PayNow/)).toBeEnabled());
    await waitFor(() => expect(button(/PayNow/)).toHaveAttribute("aria-pressed", "true"));
  });
  it("refreshes a previously open Stripe page when the gateway changes", async () => {
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Stripe", methods: ["card", "paynow"] }, error: null });
    show();
    await waitFor(() => expect(button(/Credit \/ Debit Card/)).toBeEnabled());
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Fiuu", methods: ["paynow"] }, error: null });
    await act(async () => { await client.invalidateQueries({ queryKey: ["paymentMethods"] }); });
    await waitFor(() => expect(button(/Credit \/ Debit Card/)).toBeDisabled());
    expect(button(/PayNow/)).toBeEnabled();
  });
  it("hands off directly once and prevents resubmission after browser Back", async () => {
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Fiuu", methods: ["hosted"] }, error: null });
    vi.mocked(apiCreateEmbeddedPaymentAttempt).mockResolvedValue({ data: { checkoutMode: "hosted", paymentAttemptId: 12 } as never, error: null });
    vi.mocked(submitHostedCheckout).mockResolvedValue();
    show();
    await waitFor(() => expect(container.textContent).not.toContain("Payment Method"));
    expect(container.textContent).not.toContain("Choose your payment method");
    expect(container.textContent).not.toContain("Credit / Debit Card");
    await act(async () => { (container.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    const proceed = button(/Proceed to Payment/);
    await act(async () => { proceed.click(); proceed.click(); });
    await waitFor(() => expect(submitHostedCheckout).toHaveBeenCalledTimes(1));
    expect(apiCreateEmbeddedPaymentAttempt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiCreateEmbeddedPaymentAttempt).mock.calls[0][1]).toBe("hosted");
    expect(container.textContent).not.toContain("Continue to payment");
    await act(async () => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    expect(button(/Proceed to Payment/)).toBeDisabled();
    expect(container.querySelector('a[href="/payment/result?gatewayReturn=1&attempt=12"]')).not.toBeNull();
  });
  it("retains the embedded modal for Stripe", async () => {
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Stripe", methods: ["card", "paynow"] }, error: null });
    vi.mocked(apiCreateEmbeddedPaymentAttempt).mockResolvedValue({ data: { checkoutMode: "embedded", paymentAttemptId: 13 } as never, error: null });
    show();
    await waitFor(() => expect(button(/Credit \/ Debit Card/)).toBeEnabled());
    await act(async () => { (container.querySelector('[role="switch"]') as HTMLButtonElement).click(); });
    await act(async () => { button(/Proceed to Payment/).click(); });
    await waitFor(() => expect(container.textContent).toContain("Stripe payment modal"));
    expect(submitHostedCheckout).not.toHaveBeenCalled();
  });
  it("hides the whole panel for hosted selection and restores it when switching to Stripe", async () => {
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Fiuu", methods: ["hosted"] }, error: null });
    show();
    await waitFor(() => expect(container.textContent).not.toContain("Payment Method"));
    expect(container.textContent).not.toContain("Choose your payment method");
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: { paymentGateway: "Stripe", methods: ["card", "paynow"] }, error: null });
    await act(async () => { await client.invalidateQueries({ queryKey: ["paymentMethods"] }); });
    await waitFor(() => expect(button(/Credit \/ Debit Card/)).toBeEnabled());
    expect(container.textContent).toContain("Payment Method");
    expect(button(/PayNow/)).toBeEnabled();
  });
  it("keeps checkout unavailable if capability lookup fails", async () => {
    vi.mocked(apiGetPaymentMethods).mockResolvedValue({ data: null, error: { code: "GATEWAY_UNAVAILABLE", message: "Unavailable" } });
    show();
    await waitFor(() => expect(container.querySelector("[role=alert]")).not.toBeNull());
    expect(button(/Credit \/ Debit Card/)).toBeDisabled();
    expect(button(/PayNow/)).toBeDisabled();
    expect(button(/Proceed to Payment/)).toBeDisabled();
  });
});
