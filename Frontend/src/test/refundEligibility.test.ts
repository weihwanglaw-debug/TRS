import { describe, expect, it } from "vitest";
import { refundableItems } from "@/pages/admin/Registrations";
import type { Payment, PaymentMethod, PaymentStatus, Refund } from "@/types/registration";

function payment(method: PaymentMethod = "CreditCard"): Payment {
  return {
    id: "322", registrationId: "1347", eventId: "1", gateway: "Fiuu",
    method, amount: 100, currency: "SGD", paymentStatus: "S", createdAt: "2026-10-09",
    items: [{ id: "1378", paymentId: "322", participantGroupId: "379",
      programName: "Doubles", description: "Entry", amount: 100, itemStatus: "S" }],
  };
}

function refund(status: Refund["refundStatus"], amount: number): Refund {
  return { id: "1", paymentId: "322", paymentItemId: "1378", gateway: "Fiuu",
    refundAmount: amount, refundStatus: status, createdAt: "2026-10-09" };
}

describe("registration refund eligibility", () => {
  it.each<PaymentMethod>(["CreditCard", "PayNow"])("allows a paid Fiuu %s item", method => {
    expect(refundableItems(payment(method), []).map(i => i.id)).toEqual(["1378"]);
  });

  it.each<PaymentStatus>(["P", "F", "X", "W", "FR"])("blocks payment status %s", status => {
    const p = payment(); p.paymentStatus = status;
    expect(refundableItems(p, [])).toEqual([]);
  });

  it("blocks pending refunds and fully refunded items", () => {
    expect(refundableItems(payment(), [refund("P", 100)])).toEqual([]);
    expect(refundableItems(payment(), [refund("S", 100)])).toEqual([]);
    const p = payment(); p.items[0].itemStatus = "R";
    expect(refundableItems(p, [])).toEqual([]);
  });

  it("allows the remainder after a partial refund and a retry after a failed refund", () => {
    const p = payment(); p.paymentStatus = "PR";
    expect(refundableItems(p, [refund("S", 40)])).toHaveLength(1);
    expect(refundableItems(payment(), [refund("F", 100)])).toHaveLength(1);
  });

  it.each<Payment["gateway"]>(["Stripe", "Manual", "PayNow"])("preserves %s eligibility", gateway => {
    const p = payment(); p.gateway = gateway;
    expect(refundableItems(p, [])).toHaveLength(1);
  });

  it("fails closed for missing payments and unknown gateways", () => {
    expect(refundableItems(null, [])).toEqual([]);
    const p = payment(); p.gateway = "Unknown" as Payment["gateway"];
    expect(refundableItems(p, [])).toEqual([]);
  });
});
