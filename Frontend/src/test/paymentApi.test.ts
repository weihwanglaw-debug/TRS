import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicClientToken, publicHeaders } from "@/lib/api/_base";
import {
  apiGetPaymentMethods,
  apiAbandonEmbeddedPaymentAttempt,
  apiGetEmbeddedPaymentAttemptStatus,
  apiSubmitEmbeddedPaymentAttempt,
} from "@/lib/api/registrationsApi";

describe("embedded payment API protection", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("refreshes gateway capabilities without caching or assuming card support", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ paymentGateway: "Stripe", methods: ["card", "paynow"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ paymentGateway: "Fiuu", methods: ["paynow"] }), { status: 200 }));
    expect((await apiGetPaymentMethods("SGD")).data?.methods).toEqual(["card", "paynow"]);
    expect((await apiGetPaymentMethods("SGD")).data?.methods).toEqual(["paynow"]);
    expect(fetchMock.mock.calls[1][0]).toContain("/api/Payment/methods?currency=SGD");
    expect(fetchMock.mock.calls[1][1]?.cache).toBe("no-store");
  });

  it("returns an unavailable gateway error without falling back to Stripe methods", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "GATEWAY_UNAVAILABLE", message: "Unavailable" }), { status: 503 }));
    const result = await apiGetPaymentMethods("SGD");
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("GATEWAY_UNAVAILABLE");
  });

  it("keeps a stable browser-session token for public request partitioning", () => {
    const first = getPublicClientToken();
    const second = getPublicClientToken();

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(publicHeaders()["X-TRS-Client-Token"]).toBe(first);
  });

  it("sends the secret attempt key for submit, status and abandon", async () => {
    const attemptKey = `trs_attempt_${crypto.randomUUID()}`;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "SB" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        paymentAttemptId: 42,
        status: "SB",
        expiresAt: new Date().toISOString(),
        registrationId: null,
        paymentId: null,
        reconciliationReason: null,
        errorMessage: null,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        paymentAttemptId: 42,
        status: "X",
        expiresAt: new Date().toISOString(),
        registrationId: null,
        paymentId: null,
        reconciliationReason: null,
        errorMessage: null,
      }), { status: 200 }));

    await apiSubmitEmbeddedPaymentAttempt(42, attemptKey);
    await apiGetEmbeddedPaymentAttemptStatus(42, attemptKey);
    await apiAbandonEmbeddedPaymentAttempt(42, attemptKey);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, request] of fetchMock.mock.calls) {
      const headers = request?.headers as Record<string, string>;
      expect(headers["X-Payment-Attempt-Key"]).toBe(attemptKey);
      expect(headers["X-TRS-Client-Token"]).toBeTruthy();
    }
  });
});
