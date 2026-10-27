import { describe, expect, it } from "vitest";

import {
  firstParam,
  householdQuery,
  itemWriteErrorMessage,
  joinSaleErrorMessage,
  onboardingNotice,
  partnerReferralErrorMessage,
  paypalCardView,
  pickHousehold,
  pricingAllowsManualEntry,
  pricingErrorMessage,
} from "./seller-copy";

const older = { id: "h-old", created_at: "2026-10-01T10:00:00Z" };
const newer = { id: "h-new", created_at: "2026-10-20T10:00:00Z" };

describe("pickHousehold", () => {
  it("returns null with no households", () => {
    expect(pickHousehold([], "h-old")).toBeNull();
  });

  it("uses the requested household when the seller owns it", () => {
    expect(pickHousehold([newer, older], "h-old")).toBe(older);
  });

  it("falls back to the newest for an unknown or missing id", () => {
    expect(pickHousehold([older, newer], "someone-else")).toBe(newer);
    expect(pickHousehold([older, newer], undefined)).toBe(newer);
  });

  it("builds a query and reads the first param", () => {
    expect(householdQuery("a b")).toBe("?household=a%20b");
    expect(firstParam(["x", "y"])).toBe("x");
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("paypalCardView", () => {
  const base = { paypal_payments_receivable: null, paypal_email_confirmed: null };

  it("offers the link when unlinked or revoked", () => {
    expect(paypalCardView({ ...base, paypal_status: "unlinked" })).toMatchObject({ state: "unlinked", action: "Link PayPal" });
    expect(paypalCardView({ ...base, paypal_status: "revoked" })).toMatchObject({
      state: "unlinked",
      title: "PayPal is no longer linked",
    });
  });

  it("says nothing more is needed when ready", () => {
    expect(paypalCardView({ ...base, paypal_status: "ready" })).toMatchObject({ state: "ready", action: null, missing: [] });
  });

  it("lists what is missing when pending", () => {
    const view = paypalCardView({
      paypal_status: "pending",
      paypal_email_confirmed: false,
      paypal_payments_receivable: false,
    });
    expect(view.state).toBe("pending");
    expect(view.missing).toHaveLength(2);
    expect(view.missing[0]).toMatch(/Confirm your email/);
    expect(view.missing[1]).toMatch(/cannot take payments/);
  });

  it("says it is still checking when PayPal has not answered", () => {
    const view = paypalCardView({ ...base, paypal_status: "pending" });
    expect(view.missing).toEqual([expect.stringMatching(/still checking/)]);
  });

  it("never shouts", () => {
    for (const status of ["unlinked", "pending", "ready", "revoked"] as const) {
      const view = paypalCardView({ ...base, paypal_status: status });
      expect([view.title, view.body, ...view.missing].join(" ")).not.toMatch(/!/);
    }
  });
});

describe("onboardingNotice", () => {
  it("welcomes the seller back", () => {
    expect(onboardingNotice("ready", "h1", "h1")?.tone).toBe("ready");
    expect(onboardingNotice("pending", undefined, "h1")?.tone).toBe("pending");
  });

  it("stays quiet for another household or no param", () => {
    expect(onboardingNotice("ready", "h2", "h1")).toBeNull();
    expect(onboardingNotice(undefined, "h1", "h1")).toBeNull();
    expect(onboardingNotice("weird", "h1", "h1")).toBeNull();
  });
});

describe("error messages", () => {
  it("explains join_sale failures", () => {
    expect(joinSaleErrorMessage({ code: "P0002" })).toMatch(/did not match an open sale/);
    expect(joinSaleErrorMessage({ code: "42501" })).toMatch(/Sign in again/);
    expect(joinSaleErrorMessage({ code: "XX000" })).toMatch(/Try again/);
  });

  it("explains a locked item", () => {
    expect(itemWriteErrorMessage({ code: "42501" })).toMatch(/cannot be changed/);
    expect(itemWriteErrorMessage({})).toMatch(/still here/);
  });

  it("explains pricing failures and when to fill in by hand", () => {
    expect(pricingErrorMessage(422, "pricing_refused")).toMatch(/cannot price/);
    expect(pricingErrorMessage(413)).toMatch(/too large/);
    expect(pricingErrorMessage(502, "pricing_failed")).toMatch(/fill in the details yourself/);
    expect(pricingAllowsManualEntry(502)).toBe(true);
    expect(pricingAllowsManualEntry(422)).toBe(false);
  });

  it("explains a failed PayPal link", () => {
    expect(partnerReferralErrorMessage(401)).toMatch(/Sign in again/);
    expect(partnerReferralErrorMessage(502)).toMatch(/Try again in a minute/);
  });
});
