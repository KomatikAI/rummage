import { describe, expect, it } from "vitest";

import { onboardingStatusFor } from "./onboarding";
import { captureIdFromLinks, capturedStatusAfterRefund, parseMerchantEvent, parseRefundEvent } from "./webhook-resources";

describe("parseRefundEvent", () => {
  it("reads the refund and its capture from the up link", () => {
    expect(
      parseRefundEvent({
        id: "REF-1",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "12.00" },
        links: [
          { href: "https://api-m.sandbox.paypal.com/v2/payments/refunds/REF-1", rel: "self" },
          { href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-9", rel: "up" },
        ],
      }),
    ).toEqual({ refundId: "REF-1", refundStatus: "COMPLETED", captureId: "CAP-9", amountValue: "12.00" });
  });

  it("returns null for a resource without an id", () => {
    expect(parseRefundEvent({ status: "COMPLETED" })).toBeNull();
  });

  it("finds no capture id without a capture link", () => {
    expect(captureIdFromLinks([{ href: "https://api-m.sandbox.paypal.com/v2/payments/refunds/R", rel: "self" }])).toBeUndefined();
    expect(captureIdFromLinks(undefined)).toBeUndefined();
  });
});

describe("capturedStatusAfterRefund", () => {
  it("is REFUNDED for a full refund and PARTIALLY_REFUNDED for less", () => {
    expect(capturedStatusAfterRefund("12.00", 12)).toBe("REFUNDED");
    expect(capturedStatusAfterRefund("2.00", 12)).toBe("PARTIALLY_REFUNDED");
    expect(capturedStatusAfterRefund(undefined, 12)).toBe("REFUNDED");
  });
});

describe("parseMerchantEvent", () => {
  it("reads merchant and tracking ids", () => {
    expect(parseMerchantEvent({ merchant_id: "M1", tracking_id: "T1" })).toEqual({ merchantId: "M1", trackingId: "T1" });
  });

  it("returns null when neither id is present", () => {
    expect(parseMerchantEvent({ partner_client_id: "x" })).toBeNull();
  });
});

describe("onboardingStatusFor", () => {
  it("is ready only when payments are receivable and the email is confirmed", () => {
    expect(onboardingStatusFor({ paymentsReceivable: true, primaryEmailConfirmed: true })).toBe("ready");
    expect(onboardingStatusFor({ paymentsReceivable: true, primaryEmailConfirmed: false })).toBe("pending");
    expect(onboardingStatusFor({ paymentsReceivable: false, primaryEmailConfirmed: true })).toBe("pending");
  });
});
