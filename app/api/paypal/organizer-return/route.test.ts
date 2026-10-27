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

const SALE = "a0000000-0000-4000-8000-000000000001";
const ORGANIZER = "organizer-1";
const TRACKING = `sale-${SALE}`;

const returnUrl = (params: Record<string, string>) =>
  new Request(`https://rummage.test/api/paypal/organizer-return?${new URLSearchParams(params).toString()}`);

const goodParams = {
  saleId: SALE,
  merchantId: TRACKING,
  merchantIdInPayPal: "ORGMERCH1",
  permissionsGranted: "true",
  isEmailConfirmed: "true",
};

function integration(overrides: Partial<MerchantIntegrationStatus> = {}): MerchantIntegrationStatus {
  return {
    merchantId: "ORGMERCH1",
    trackingId: TRACKING,
    paymentsReceivable: true,
    primaryEmailConfirmed: true,
    hasPaymentScope: true,
    hasRefundScope: true,
    readyToSell: true,
    raw: {},
    ...overrides,
  };
}

function setup(userId: string | null, options: { sale?: Record<string, unknown> | null; readFails?: boolean; updateFails?: boolean } = {}) {
  const db = fakeDb((q: FakeQuery) => {
    if (q.table !== "sales") return undefined;
    if (q.action === "update") return options.updateFails ? dbFail() : ok(null);
    if (options.readFails) return dbFail();
    return ok(options.sale === undefined ? { id: SALE, organizer_user_id: ORGANIZER } : options.sale);
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

describe("GET /api/paypal/organizer-return validation and auth", () => {
  it("400s without a sale id or merchant id", async () => {
    setup(ORGANIZER);
    expect((await GET(returnUrl({ merchantIdInPayPal: "M1" }))).status).toBe(400);
    expect((await GET(returnUrl({ saleId: SALE, merchantIdInPayPal: "bad id!" }))).status).toBe(400);
    const response = await GET(returnUrl({ saleId: SALE }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "missing_merchant_id" });
  });

  it("401s when signed out, 404s an unknown sale, 403s another organizer's", async () => {
    setup(null);
    expect((await GET(returnUrl(goodParams))).status).toBe(401);
    setup(ORGANIZER, { sale: null });
    expect((await GET(returnUrl(goodParams))).status).toBe(404);
    setup("other");
    expect((await GET(returnUrl(goodParams))).status).toBe(403);
    setup(ORGANIZER, { sale: { id: SALE, organizer_user_id: null } });
    expect((await GET(returnUrl(goodParams))).status).toBe(403);
    expect(getMerchantIntegration).not.toHaveBeenCalled();
  });

  it("500s when the sale cannot be read", async () => {
    setup(ORGANIZER, { readFails: true });
    expect((await GET(returnUrl(goodParams))).status).toBe(500);
  });

  it("rejects a return whose tracking id is not this sale's", async () => {
    setup(ORGANIZER);
    const response = await GET(returnUrl({ ...goodParams, merchantId: "b0000000-0000-4000-8000-000000000001" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "tracking_mismatch" });
  });

  it("rejects a merchant PayPal reports under another tracking id", async () => {
    const db = setup(ORGANIZER);
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ trackingId: "sale-other" }));
    const response = await GET(returnUrl(goodParams));
    expect(response.status).toBe(403);
    expect(db.queries.some((q) => q.action === "update")).toBe(false);
  });
});

describe("GET /api/paypal/organizer-return onboarding", () => {
  it("stores the organizer merchant id and redirects ready when PayPal confirms both flags", async () => {
    const db = setup(ORGANIZER);
    const response = await GET(returnUrl(goodParams));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://rummage.test/organizer/${SALE}?onboarding=ready`);
    expect(getMerchantIntegration).toHaveBeenCalledWith({ merchantIdInPayPal: "ORGMERCH1" });
    const update = db.queries.find((q) => q.action === "update");
    expect(update?.table).toBe("sales");
    expect(update?.payload).toEqual({ organizer_merchant_id: "ORGMERCH1" });
  });

  it("redirects pending and stores nothing when the email is not confirmed, whatever the browser claims", async () => {
    const db = setup(ORGANIZER);
    vi.mocked(getMerchantIntegration).mockResolvedValue(integration({ primaryEmailConfirmed: false }));
    const response = await GET(returnUrl(goodParams));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://rummage.test/organizer/${SALE}?onboarding=pending`);
    expect(db.queries.some((q) => q.action === "update")).toBe(false);
  });

  it("502s when PayPal cannot be reached and 500s when the update fails", async () => {
    setup(ORGANIZER);
    vi.mocked(getMerchantIntegration).mockRejectedValue(
      new PayPalApiError({ status: 503, paypalName: "SERVICE_UNAVAILABLE", message: "x", method: "GET", path: "/v1" }),
    );
    expect((await GET(returnUrl(goodParams))).status).toBe(502);

    vi.mocked(getMerchantIntegration).mockResolvedValue(integration());
    setup(ORGANIZER, { updateFails: true });
    expect((await GET(returnUrl(goodParams))).status).toBe(500);
  });
});
