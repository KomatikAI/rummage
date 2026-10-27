import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, fakeDb, fakeSessionClient, ok, type FakeQuery } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://rummage.test" } }));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMerchantIntegration: vi.fn(),
}));

import { getMerchantIntegration, PayPalApiError, type MerchantIntegrationStatus } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { GET } from "./route";

const H1 = "b0000000-0000-4000-8000-000000000001";
const SELLER = "seller-1";

const returnUrl = (params: Record<string, string>) =>
  new Request(`https://rummage.test/api/paypal/partner-return?${new URLSearchParams(params).toString()}`);

const goodParams = {
  householdId: H1,
  merchantId: "track-1",
  merchantIdInPayPal: "SANDBOXMERCH1",
  permissionsGranted: "true",
  isEmailConfirmed: "true",
};

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

function setup(userId: string | null, options: { household?: Record<string, unknown> | null; updateFails?: boolean } = {}) {
  const db = fakeDb((q: FakeQuery) => {
    if (q.table !== "households") return undefined;
    if (q.action === "update") return options.updateFails ? dbFail() : ok(null);
    return ok(options.household === undefined ? { id: H1, owner_user_id: SELLER, tracking_id: "track-1" } : options.household);
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(getMerchantIntegration).mockReset();
  vi.mocked(getMerchantIntegration).mockResolvedValue(integration());
});

describe("GET /api/paypal/partner-return validation and auth", () => {
  it("400s without a household id or merchant id", async () => {
    setup(SELLER);
    expect((await GET(returnUrl({ merchantIdInPayPal: "M1" }))).status).toBe(400);
    const response = await GET(returnUrl({ householdId: H1 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "missing_merchant_id" });
  });

  it("401s when signed out, 404s an unknown household, 403s another owner's", async () => {
    setup(null);
    expect((await GET(returnUrl(goodParams))).status).toBe(401);
    setup(SELLER, { household: null });
    expect((await GET(returnUrl(goodParams))).status).toBe(404);
    setup("other");
    expect((await GET(returnUrl(goodParams))).status).toBe(403);
    expect(getMerchantIntegration).not.toHaveBeenCalled();
  });

  it("rejects a return whose tracking id belongs to another household", async () => {
    setup(SELLER);
    const response = await GET(returnUrl({ ...goodParams, merchantId: "track-2" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "tracking_mismatch" });
  });

  it("rejects a merchant PayPal reports under another tracking id", async () => {
    const db = setup(SELLER);
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ trackingId: "track-9" }));
    const response = await GET(returnUrl(goodParams));
    expect(response.status).toBe(403);
    expect(db.queries.some((q) => q.action === "update")).toBe(false);
  });
});

describe("GET /api/paypal/partner-return onboarding", () => {
  it("stores the merchant id and redirects ready when PayPal confirms both flags", async () => {
    const db = setup(SELLER);
    const response = await GET(returnUrl(goodParams));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://rummage.test/seller?household=${H1}&onboarding=ready`);
    expect(getMerchantIntegration).toHaveBeenCalledWith({ merchantIdInPayPal: "SANDBOXMERCH1" });
    const update = db.queries.find((q) => q.action === "update");
    expect(update?.payload).toMatchObject({ merchant_id_in_paypal: "SANDBOXMERCH1", paypal_status: "ready" });
    expect(typeof (update?.payload as { paypal_checked_at: unknown }).paypal_checked_at).toBe("string");
  });

  it("redirects pending when the email is not confirmed, whatever the browser claims", async () => {
    const db = setup(SELLER);
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ primaryEmailConfirmed: false }));
    const response = await GET(returnUrl(goodParams));
    expect(response.headers.get("location")).toContain("onboarding=pending");
    expect(db.queries.find((q) => q.action === "update")?.payload).toMatchObject({ paypal_status: "pending" });
  });

  it("502s when PayPal cannot be reached and 500s when the update fails", async () => {
    setup(SELLER);
    vi.mocked(getMerchantIntegration).mockRejectedValue(
      new PayPalApiError({ status: 503, paypalName: "SERVICE_UNAVAILABLE", message: "x", method: "GET", path: "/v1" }),
    );
    expect((await GET(returnUrl(goodParams))).status).toBe(502);

    vi.mocked(getMerchantIntegration).mockResolvedValue(integration());
    setup(SELLER, { updateFails: true });
    expect((await GET(returnUrl(goodParams))).status).toBe(500);
  });
});
