import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, fakeSessionClient, jsonRequest, ok, type FakeQuery } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://rummage.test" } }));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refundCapture: vi.fn(),
}));

import { PayPalApiError, refundCapture } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const URL_ = "https://rummage.test/api/paypal/refund";
const H1 = "b0000000-0000-4000-8000-000000000001";
const SELLER = "seller-1";
const ORGANIZER = "organizer-1";

type Unit = {
  id: string;
  cart_id: string;
  household_id: string | null;
  merchant_id: string;
  capture_status: string | null;
  refund_id: string | null;
  refund_status: string | null;
};

const baseUnit: Unit = {
  id: "pu-1",
  cart_id: "cart-1",
  household_id: H1,
  merchant_id: "MERCH1",
  capture_status: "COMPLETED",
  refund_id: null,
  refund_status: null,
};

function setup(userId: string | null, unit: Unit | null = baseUnit) {
  const db = fakeDb((q: FakeQuery) => {
    if (q.table === "purchase_units" && q.action === "select") return ok(unit);
    if (q.table === "carts") return ok({ sale_id: "sale-1" });
    if (q.table === "sales") return ok({ organizer_user_id: ORGANIZER });
    if (q.table === "households") return ok({ owner_user_id: SELLER });
    return undefined;
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(refundCapture).mockReset();
  vi.mocked(refundCapture).mockResolvedValue({ id: "REF-1", status: "COMPLETED", raw: { id: "REF-1", status: "COMPLETED" } });
});

describe("POST /api/paypal/refund", () => {
  it("validates the body", async () => {
    setup(SELLER);
    expect((await POST(jsonRequest(URL_, {}))).status).toBe(400);
    expect((await POST(jsonRequest(URL_, { captureId: "CAP-1", reason: "x".repeat(300) }))).status).toBe(400);
  });

  it("requires sign-in", async () => {
    setup(null);
    expect((await POST(jsonRequest(URL_, { captureId: "CAP-1" }))).status).toBe(401);
  });

  it("404s an unknown capture", async () => {
    setup(SELLER, null);
    const response = await POST(jsonRequest(URL_, { captureId: "CAP-1" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "capture_not_found" });
  });

  it("403s anyone but the organizer or the paid seller", async () => {
    setup("buyer-1");
    const response = await POST(jsonRequest(URL_, { captureId: "CAP-1" }));
    expect(response.status).toBe(403);
    expect(refundCapture).not.toHaveBeenCalled();
  });

  it("lets only the organizer refund the donation unit", async () => {
    setup(SELLER, { ...baseUnit, household_id: null, merchant_id: "ORGMERCH" });
    expect((await POST(jsonRequest(URL_, { captureId: "CAP-D" }))).status).toBe(403);
    setup(ORGANIZER, { ...baseUnit, household_id: null, merchant_id: "ORGMERCH" });
    expect((await POST(jsonRequest(URL_, { captureId: "CAP-D" }))).status).toBe(200);
    expect(vi.mocked(refundCapture).mock.calls[0][0]).toMatchObject({ merchantId: "ORGMERCH" });
  });

  it("409s an uncaptured or already refunded unit", async () => {
    setup(SELLER, { ...baseUnit, capture_status: "PENDING" });
    expect(await (await POST(jsonRequest(URL_, { captureId: "CAP-1" }))).json()).toMatchObject({ error: "not_refundable" });
    setup(SELLER, { ...baseUnit, refund_id: "REF-0", refund_status: "COMPLETED", capture_status: "REFUNDED" });
    expect(await (await POST(jsonRequest(URL_, { captureId: "CAP-1" }))).json()).toMatchObject({ error: "already_refunded" });
  });

  it("refunds in full as the seller and stores the refund", async () => {
    const db = setup(SELLER);
    const response = await POST(jsonRequest(URL_, { captureId: "CAP-1", reason: "Item was broken" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refundId: "REF-1", refundStatus: "COMPLETED", captureStatus: "REFUNDED" });
    expect(refundCapture).toHaveBeenCalledWith({
      captureId: "CAP-1",
      merchantId: "MERCH1",
      noteToPayer: "Item was broken",
      requestId: "refund-CAP-1",
    });
    const update = db.queries.find((q) => q.table === "purchase_units" && q.action === "update");
    expect(update?.payload).toEqual({ refund_id: "REF-1", refund_status: "COMPLETED", capture_status: "REFUNDED" });
  });

  it("keeps the capture status while the refund is pending", async () => {
    setup(ORGANIZER);
    vi.mocked(refundCapture).mockResolvedValue({ id: "REF-2", status: "PENDING", raw: { id: "REF-2", status: "PENDING" } });
    expect(await (await POST(jsonRequest(URL_, { captureId: "CAP-1" }))).json()).toEqual({
      refundId: "REF-2",
      refundStatus: "PENDING",
      captureStatus: "COMPLETED",
    });
  });

  it("502s when PayPal refuses", async () => {
    setup(SELLER);
    vi.mocked(refundCapture).mockRejectedValue(
      new PayPalApiError({ status: 422, paypalName: "UNPROCESSABLE_ENTITY", message: "x", debugId: "dbg-r", method: "POST", path: "/v2" }),
    );
    const response = await POST(jsonRequest(URL_, { captureId: "CAP-1" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ debugId: "dbg-r" });
  });
});
