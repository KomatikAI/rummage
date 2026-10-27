import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, eqValue, fakeDb, fakeSessionClient, jsonRequest, ok, type FakeQuery } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://rummage.test/" } }));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPartnerReferral: vi.fn(),
}));

import { createPartnerReferral, PayPalApiError } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const URL_ = "https://rummage.test/api/paypal/organizer-referral";
const SALE = "a0000000-0000-4000-8000-000000000001";
const ORGANIZER = "organizer-1";

type SaleFixture = Record<string, unknown> | null | "fail";

function setup(
  userId: string | null,
  sale: SaleFixture = { id: SALE, organizer_user_id: ORGANIZER, fundraiser_name: "Maple Street Elementary PTA" },
) {
  const db = fakeDb((q: FakeQuery) => {
    if (q.table !== "sales") return undefined;
    return sale === "fail" ? dbFail() : ok(sale);
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(createPartnerReferral).mockReset();
  vi.mocked(createPartnerReferral).mockResolvedValue({
    actionUrl: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=org",
    selfUrl: undefined,
    raw: { links: [] },
  });
});

describe("POST /api/paypal/organizer-referral", () => {
  it("validates the body and requires sign-in", async () => {
    setup(ORGANIZER);
    expect((await POST(jsonRequest(URL_, { saleId: "x" }))).status).toBe(400);
    expect((await POST(jsonRequest(URL_, "{not json"))).status).toBe(400);
    setup(null);
    expect((await POST(jsonRequest(URL_, { saleId: SALE }))).status).toBe(401);
  });

  it("404s an unknown sale and 403s someone else's or an unowned one", async () => {
    setup(ORGANIZER, null);
    expect((await POST(jsonRequest(URL_, { saleId: SALE }))).status).toBe(404);
    setup("other-user");
    const response = await POST(jsonRequest(URL_, { saleId: SALE }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
    setup(ORGANIZER, { id: SALE, organizer_user_id: null, fundraiser_name: "PTA" });
    expect((await POST(jsonRequest(URL_, { saleId: SALE }))).status).toBe(403);
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("409s a sale without a fundraiser", async () => {
    setup(ORGANIZER, { id: SALE, organizer_user_id: ORGANIZER, fundraiser_name: null });
    const response = await POST(jsonRequest(URL_, { saleId: SALE }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "no_fundraiser" });
  });

  it("500s when the sale cannot be read", async () => {
    setup(ORGANIZER, "fail");
    expect((await POST(jsonRequest(URL_, { saleId: SALE }))).status).toBe(500);
  });

  it("creates a referral keyed by the sale with an organizer return URL", async () => {
    const db = setup(ORGANIZER);
    const response = await POST(jsonRequest(URL_, { saleId: SALE }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actionUrl: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=org",
    });
    expect(createPartnerReferral).toHaveBeenCalledWith({
      trackingId: `sale-${SALE}`,
      returnUrl: `https://rummage.test/api/paypal/organizer-return?saleId=${SALE}`,
    });
    const read = db.queries.find((q) => q.table === "sales");
    expect(read && eqValue(read, "id")).toBe(SALE);
  });

  it("502s when PayPal fails", async () => {
    setup(ORGANIZER);
    vi.mocked(createPartnerReferral).mockRejectedValue(
      new PayPalApiError({ status: 400, paypalName: "INVALID_REQUEST", message: "x", debugId: "dbg-o", method: "POST", path: "/v2" }),
    );
    const response = await POST(jsonRequest(URL_, { saleId: SALE }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "paypal_error", debugId: "dbg-o" });
  });
});
