import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, eqValue, fakeDb, ok, type FakeQuery } from "@/lib/checkout/test-db";

vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMerchantIntegration: vi.fn(),
}));

import { getMerchantIntegration, type MerchantIntegrationStatus } from "@/lib/paypal";

import { organizerTrackingId, refreshOrganizerOnboarding } from "./onboarding";

const SALE = "a0000000-0000-4000-8000-000000000001";

function integration(overrides: Partial<MerchantIntegrationStatus> = {}): MerchantIntegrationStatus {
  return {
    merchantId: "ORGMERCH1",
    trackingId: organizerTrackingId(SALE),
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
  vi.mocked(getMerchantIntegration).mockResolvedValue(integration());
});

describe("organizerTrackingId", () => {
  it("prefixes the sale id so it never matches a household tracking id", () => {
    expect(organizerTrackingId(SALE)).toBe(`sale-${SALE}`);
  });
});

describe("refreshOrganizerOnboarding", () => {
  it("stores the merchant id on the sale when PayPal says it is ready", async () => {
    const db = fakeDb((q: FakeQuery) => (q.table === "sales" ? ok(null) : undefined));
    const result = await refreshOrganizerOnboarding(db.client, { id: SALE }, "ORGMERCH1");
    expect(result).toEqual({ kind: "updated", status: "ready", stored: true });
    expect(getMerchantIntegration).toHaveBeenCalledWith({ merchantIdInPayPal: "ORGMERCH1" });
    const update = db.queries.find((q) => q.action === "update");
    expect(update?.table).toBe("sales");
    expect(update?.payload).toEqual({ organizer_merchant_id: "ORGMERCH1" });
    expect(update && eqValue(update, "id")).toBe(SALE);
  });

  it("stores nothing while the account is pending", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ paymentsReceivable: false }));
    const db = fakeDb();
    expect(await refreshOrganizerOnboarding(db.client, { id: SALE }, "ORGMERCH1")).toEqual({
      kind: "updated",
      status: "pending",
      stored: false,
    });
    expect(db.queries).toHaveLength(0);
  });

  it("refuses an integration made for something else", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ trackingId: "b0000000-0000-4000-8000-000000000001" }));
    const db = fakeDb();
    expect(await refreshOrganizerOnboarding(db.client, { id: SALE }, "ORGMERCH1")).toEqual({ kind: "tracking_mismatch" });
    expect(db.queries).toHaveLength(0);
  });

  it("reports a failed update by code", async () => {
    const db = fakeDb(() => dbFail("42501"));
    expect(await refreshOrganizerOnboarding(db.client, { id: SALE }, "ORGMERCH1")).toEqual({ kind: "db_error", code: "42501" });
  });
});
