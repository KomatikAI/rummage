import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, fakeSessionClient, jsonRequest, ok, type FakeQuery } from "@/lib/checkout/test-db";

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

const URL_ = "https://rummage.test/api/paypal/partner-referral";
const H1 = "b0000000-0000-4000-8000-000000000001";
const SELLER = "seller-1";

function setup(userId: string | null, household: Record<string, unknown> | null = { id: H1, owner_user_id: SELLER, tracking_id: "track-1" }) {
  const db = fakeDb((q: FakeQuery) => (q.table === "households" ? ok(household) : undefined));
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(createPartnerReferral).mockReset();
  vi.mocked(createPartnerReferral).mockResolvedValue({
    actionUrl: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=abc",
    selfUrl: undefined,
    raw: { links: [] },
  });
});

describe("POST /api/paypal/partner-referral", () => {
  it("validates the body and requires sign-in", async () => {
    setup(SELLER);
    expect((await POST(jsonRequest(URL_, { householdId: "x" }))).status).toBe(400);
    setup(null);
    expect((await POST(jsonRequest(URL_, { householdId: H1 }))).status).toBe(401);
  });

  it("404s an unknown household and 403s someone else's", async () => {
    setup(SELLER, null);
    expect((await POST(jsonRequest(URL_, { householdId: H1 }))).status).toBe(404);
    setup("other-user");
    expect((await POST(jsonRequest(URL_, { householdId: H1 }))).status).toBe(403);
    expect(createPartnerReferral).not.toHaveBeenCalled();
  });

  it("creates a referral with the household's tracking id and a return URL", async () => {
    setup(SELLER);
    const response = await POST(jsonRequest(URL_, { householdId: H1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actionUrl: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=abc",
    });
    expect(createPartnerReferral).toHaveBeenCalledWith({
      trackingId: "track-1",
      returnUrl: `https://rummage.test/api/paypal/partner-return?householdId=${H1}`,
    });
  });

  it("502s when PayPal fails", async () => {
    setup(SELLER);
    vi.mocked(createPartnerReferral).mockRejectedValue(
      new PayPalApiError({ status: 400, paypalName: "INVALID_REQUEST", message: "x", debugId: "dbg-p", method: "POST", path: "/v2" }),
    );
    const response = await POST(jsonRequest(URL_, { householdId: H1 }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "paypal_error", debugId: "dbg-p" });
  });
});
