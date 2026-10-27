import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, eqValue, fakeDb, ok } from "./test-db";

vi.mock("@/lib/paypal", () => ({ getMerchantIntegration: vi.fn() }));

import { getMerchantIntegration, type MerchantIntegrationStatus } from "@/lib/paypal";

import { onboardingStatusFor, refreshHouseholdOnboarding } from "./onboarding";

const HOUSEHOLD = { id: "b0000000-0000-4000-8000-000000000001", tracking_id: "track-1" };
const NOW = new Date("2026-10-28T09:00:00Z");

function integration(overrides: Partial<MerchantIntegrationStatus> = {}): MerchantIntegrationStatus {
  return {
    merchantId: "SANDBOXMERCH1",
    trackingId: "track-1",
    paymentsReceivable: true,
    primaryEmailConfirmed: true,
    hasPaymentScope: true,
    hasRefundScope: true,
    readyToSell: true,
    raw: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getMerchantIntegration).mockReset();
});

describe("onboardingStatusFor", () => {
  it("is ready only when payments are receivable and the email is confirmed", () => {
    expect(onboardingStatusFor({ paymentsReceivable: true, primaryEmailConfirmed: true })).toBe("ready");
    expect(onboardingStatusFor({ paymentsReceivable: false, primaryEmailConfirmed: true })).toBe("pending");
    expect(onboardingStatusFor({ paymentsReceivable: true, primaryEmailConfirmed: false })).toBe("pending");
  });
});

describe("refreshHouseholdOnboarding", () => {
  it("stores the merchant id, both readiness flags and the derived status", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration());
    const db = fakeDb(() => ok(null));

    await expect(refreshHouseholdOnboarding(db.client, HOUSEHOLD, "SANDBOXMERCH1", NOW)).resolves.toEqual({
      kind: "updated",
      status: "ready",
    });
    expect(getMerchantIntegration).toHaveBeenCalledWith({ merchantIdInPayPal: "SANDBOXMERCH1" });
    const [update] = db.queries;
    expect(update).toMatchObject({ table: "households", action: "update" });
    expect(eqValue(update, "id")).toBe(HOUSEHOLD.id);
    expect(update.payload).toEqual({
      merchant_id_in_paypal: "SANDBOXMERCH1",
      paypal_status: "ready",
      paypal_payments_receivable: true,
      paypal_email_confirmed: true,
      paypal_checked_at: NOW.toISOString(),
    });
  });

  it("keeps the flag that is missing when the status is pending", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ primaryEmailConfirmed: false }));
    const db = fakeDb(() => ok(null));

    await expect(refreshHouseholdOnboarding(db.client, HOUSEHOLD, "SANDBOXMERCH1", NOW)).resolves.toEqual({
      kind: "updated",
      status: "pending",
    });
    expect(db.queries[0].payload).toMatchObject({
      paypal_status: "pending",
      paypal_payments_receivable: true,
      paypal_email_confirmed: false,
    });
  });

  it("writes nothing when the integration belongs to another tracking id", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ trackingId: "someone-else" }));
    const db = fakeDb(() => ok(null));

    await expect(refreshHouseholdOnboarding(db.client, HOUSEHOLD, "SANDBOXMERCH1", NOW)).resolves.toEqual({
      kind: "tracking_mismatch",
    });
    expect(db.queries).toHaveLength(0);
  });

  it("reports the database error code", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration());
    const db = fakeDb(() => dbFail("42501"));

    await expect(refreshHouseholdOnboarding(db.client, HOUSEHOLD, "SANDBOXMERCH1", NOW)).resolves.toEqual({
      kind: "db_error",
      code: "42501",
    });
  });
});
