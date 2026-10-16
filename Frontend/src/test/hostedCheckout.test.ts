import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedAttemptStorageKey, prepareHostedCheckout, readHostedAttemptKey, submitHostedCheckout } from "@/lib/hostedCheckout";
import { apiRecoverHostedPaymentAttempt } from "@/lib/api/registrationsApi";
import type { EmbeddedPaymentAttempt } from "@/types/registration";

const attempt = (): EmbeddedPaymentAttempt => ({
  paymentAttemptId: 12, attemptKey: "a".repeat(64), paymentIntentId: "order1", clientSecret: null, publishableKey: null,
  checkoutMode: "hosted", paymentGateway: "Fiuu", status: "CR", amount: 12.34, currency: "SGD", paymentMethod: "CreditCard",
  expiresAt: new Date(Date.now() + 120000).toISOString(),
  hostedCheckout: { url: "https://sandbox-payment.fiuu.com/RMS/pay/SB_test/", fields: { orderid: "order1", amount: "12.34", bill_name: '<script>alert("x")</script>' } },
});

describe("hosted checkout handoff", () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
  it("allows the exact production Fiuu origin for a production merchant", () => {
    const data = attempt(); data.hostedCheckout!.url = "https://pay.fiuu.com/RMS/pay/live_test/";
    expect(prepareHostedCheckout(data).action).toBe(data.hostedCheckout!.url);
  });
  it("saves the access token locally and posts provider fields without interpreting HTML", () => {
    const data = attempt();
    const form = prepareHostedCheckout(data);
    expect(form.method).toBe("post");
    expect(form.target).toBe("_self");
    expect(form.querySelector("script")).toBeNull();
    expect(new FormData(form).get("bill_name")).toBe(data.hostedCheckout!.fields.bill_name);
    expect(form.outerHTML).not.toContain(data.attemptKey);
    expect(readHostedAttemptKey(12)).toBe(data.attemptKey);
  });
  it.each(["https://evil.example/RMS/pay/SB_test/", "javascript:alert(1)", "https://sandbox-payment.fiuu.com.evil.example/RMS/pay/SB_test/", "https://pay.fiuu.com/RMS/pay/SB_test/"])("rejects unsupported destination %s", url => {
    const data = attempt(); data.hostedCheckout!.url = url;
    expect(() => prepareHostedCheckout(data)).toThrow();
    expect(sessionStorage.getItem(hostedAttemptStorageKey(12))).toBeNull();
  });
  it("fails before payment submission if browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    expect(() => prepareHostedCheckout(attempt())).toThrow("Storage unavailable");
  });
  it("marks submitted before posting the hosted form and removes it afterwards", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "SB" }), { status: 200 }));
    const post = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(this.isConnected).toBe(true);
      expect(readHostedAttemptKey(12)).toBe(attempt().attemptKey);
    });
    await submitHostedCheckout(attempt());
    expect(post).toHaveBeenCalledTimes(1);
    expect(document.querySelector("form")).toBeNull();
  });
  it("does not dispatch an expired attempt", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const data = attempt(); data.expiresAt = new Date(0).toISOString();
    await expect(submitHostedCheckout(data)).rejects.toMatchObject({ uncertain: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires status recovery after an ambiguous submission failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network interrupted"));
    const post = vi.spyOn(HTMLFormElement.prototype, "submit");
    await expect(submitHostedCheckout(attempt())).rejects.toMatchObject({ uncertain: true });
    expect(post).not.toHaveBeenCalled();
    expect(readHostedAttemptKey(12)).not.toBeNull();
  });
  it("requires status recovery if browser navigation throws", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "SB" }), { status: 200 }));
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => { throw new Error("Navigation failed"); });
    await expect(submitHostedCheckout(attempt())).rejects.toMatchObject({ uncertain: true });
    expect(document.querySelector("form")).toBeNull();
  });
  it("recovery sends the access token in a header, never the URL", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "SB" }), { status: 200 }));
    await apiRecoverHostedPaymentAttempt(12, attempt().attemptKey);
    const [url, request] = fetch.mock.calls[0];
    expect(String(url)).toContain("/embedded-attempt/12/recover");
    expect(String(url)).not.toContain(attempt().attemptKey);
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>)["X-Payment-Attempt-Key"]).toBe(attempt().attemptKey);
  });
});
