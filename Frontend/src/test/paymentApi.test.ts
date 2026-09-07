import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicClientToken, publicHeaders } from "@/lib/api/_base";
import {
  apiAbandonEmbeddedPaymentAttempt,
  apiGetEmbeddedPaymentAttemptStatus,
  apiSubmitEmbeddedPaymentAttempt,
} from "@/lib/api/registrationsApi";

describe("embedded payment API protection", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
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
