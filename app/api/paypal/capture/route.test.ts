import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, eqValue, fakeDb, fakeSessionClient, jsonRequest, ok, type FakeQuery } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://rummage.test" } }));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureOrder: vi.fn(),
  resolveTimedOutCapture: vi.fn(),
}));

import { captureOrder, PayPalApiError, resolveTimedOutCapture, type CaptureResult } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const URL_ = "https://rummage.test/api/paypal/capture";
const CART = "c0000000-0000-4000-8000-000000000001";
const BUYER = "buyer-1";
const H1 = "b0000000-0000-4000-8000-000000000001";
const H2 = "b0000000-0000-4000-8000-000000000002";

const storedUnits = [
  { reference_id: H1, household_id: H1, merchant_id: "MERCH1", capture_id: null, capture_status: null },
  { reference_id: H2, household_id: H2, merchant_id: "MERCH2", capture_id: null, capture_status: null },
];

type SetupOptions = {
  cart?: Record<string, unknown> | null;
  userId?: string | null;
  rpcError?: boolean;
  /** What the capture_attempts bump returns: the updated rows, or a database error. */
  bump?: "ok" | "no_row" | "error";
};

function setup(options: SetupOptions = {}) {
  const db = fakeDb(
    (q: FakeQuery) => {
      if (q.table === "carts" && q.action === "update") {
        if (options.bump === "error") return dbFail();
        return ok(options.bump === "no_row" ? [] : [{ id: CART }]);
      }
      if (q.table === "carts") {
        return ok(
          options.cart === undefined ? { id: CART, buyer_user_id: BUYER, status: "checkout", capture_attempts: 0 } : options.cart,
        );
      }
      if (q.table === "purchase_units") return ok(storedUnits);
      return undefined;
    },
    () => (options.rpcError ? dbFail() : undefined),
  );
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(options.userId === undefined ? BUYER : options.userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

const order = { id: "ORDER-1", status: "COMPLETED" };
const completed: CaptureResult = {
  outcome: "completed",
  orderId: "ORDER-1",
  orderStatus: "COMPLETED",
  units: [
    { referenceId: H1, captureId: "CAP-1", captureStatus: "COMPLETED", sellerReceivable: { gross_amount: { currency_code: "USD", value: "17.50" }, net_amount: { currency_code: "USD", value: "16.64" } } },
    { referenceId: H2, captureId: "CAP-2", captureStatus: "COMPLETED" },
  ],
  raw: order,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(captureOrder).mockReset();
  vi.mocked(resolveTimedOutCapture).mockReset();
});

describe("POST /api/paypal/capture validation and auth", () => {
  it("rejects a missing or malformed order id", async () => {
    setup();
    expect((await POST(jsonRequest(URL_, {}))).status).toBe(400);
    const response = await POST(jsonRequest(URL_, { orderId: "../etc" }));
    expect(await response.json()).toMatchObject({ error: "invalid_body" });
  });

  it("requires a signed-in buyer", async () => {
    setup({ userId: null });
    expect((await POST(jsonRequest(URL_, { orderId: "ORDER-1" }))).status).toBe(401);
  });

  it("404s an order with no cart and 403s another buyer's order", async () => {
    setup({ cart: null });
    expect((await POST(jsonRequest(URL_, { orderId: "ORDER-1" }))).status).toBe(404);
    setup({ cart: { id: CART, buyer_user_id: "someone-else", status: "checkout", capture_attempts: 0 } });
    expect((await POST(jsonRequest(URL_, { orderId: "ORDER-1" }))).status).toBe(403);
    expect(captureOrder).not.toHaveBeenCalled();
  });

  it("409s an open or abandoned cart", async () => {
    setup({ cart: { id: CART, buyer_user_id: BUYER, status: "abandoned", capture_attempts: 0 } });
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cart_not_in_checkout" });
  });
});

describe("POST /api/paypal/capture outcomes", () => {
  it("completed: records every unit and returns per-household statuses", async () => {
    const db = setup();
    vi.mocked(captureOrder).mockResolvedValue(completed);
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "completed",
      units: [
        { householdId: H1, referenceId: H1, status: "COMPLETED", captureId: "CAP-1" },
        { householdId: H2, referenceId: H2, status: "COMPLETED", captureId: "CAP-2" },
      ],
    });
    expect(captureOrder).toHaveBeenCalledWith("ORDER-1", { requestId: `capture:${CART}:1` });
    expect(db.rpcs).toEqual([
      {
        fn: "mark_units_captured",
        args: {
          p_cart: CART,
          p_units: [
            { reference_id: H1, capture_id: "CAP-1", capture_status: "COMPLETED", seller_receivable: 16.64 },
            { reference_id: H2, capture_id: "CAP-2", capture_status: "COMPLETED", seller_receivable: null },
          ],
        },
      },
    ]);
  });

  it("partial: declined units are recorded too", async () => {
    const db = setup();
    vi.mocked(captureOrder).mockResolvedValue({
      ...completed,
      outcome: "partial",
      units: [completed.units[0], { referenceId: H2, captureId: "CAP-2", captureStatus: "DECLINED" }],
    });
    const body = await (await POST(jsonRequest(URL_, { orderId: "ORDER-1" }))).json();
    expect(body.outcome).toBe("partial");
    expect(body.units.map((u: { status: string }) => u.status)).toEqual(["COMPLETED", "DECLINED"]);
    const args = db.rpcs[0].args as { p_units: { capture_status: string }[] };
    expect(args.p_units.map((u) => u.capture_status)).toEqual(["COMPLETED", "DECLINED"]);
  });

  it("none: records nothing and returns PayPal's issues", async () => {
    const db = setup();
    vi.mocked(captureOrder).mockResolvedValue({
      outcome: "none",
      orderId: "ORDER-1",
      units: [],
      error: { name: "UNPROCESSABLE_ENTITY", message: "declined", debugId: "dbg-9", details: [{ issue: "INSTRUMENT_DECLINED" }] },
      raw: undefined,
    });
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(await response.json()).toEqual({
      outcome: "none",
      units: [
        { householdId: H1, referenceId: H1, status: "NOT_CAPTURED" },
        { householdId: H2, referenceId: H2, status: "NOT_CAPTURED" },
      ],
      issues: ["INSTRUMENT_DECLINED"],
      debugId: "dbg-9",
    });
    expect(db.rpcs).toEqual([]);
  });

  it("timeout: resolves the order once, then records the same way", async () => {
    const db = setup();
    vi.mocked(captureOrder).mockResolvedValue({ outcome: "timeout", orderId: "ORDER-1", units: [], raw: null });
    vi.mocked(resolveTimedOutCapture).mockResolvedValue(completed);
    const body = await (await POST(jsonRequest(URL_, { orderId: "ORDER-1" }))).json();
    expect(resolveTimedOutCapture).toHaveBeenCalledOnce();
    expect(resolveTimedOutCapture).toHaveBeenCalledWith("ORDER-1");
    expect(body.outcome).toBe("completed");
    expect(db.rpcs).toHaveLength(1);
  });

  it("502s with the debug id when PayPal errors", async () => {
    setup();
    vi.mocked(captureOrder).mockRejectedValue(
      new PayPalApiError({ status: 500, paypalName: "INTERNAL_SERVER_ERROR", message: "x", debugId: "dbg-5", method: "POST", path: "/v2" }),
    );
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "paypal_error", debugId: "dbg-5" });
  });

  it("500s when mark_units_captured fails", async () => {
    setup({ rpcError: true });
    vi.mocked(captureOrder).mockResolvedValue(completed);
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "database_error" });
  });
});

describe("POST /api/paypal/capture attempts", () => {
  const declined: CaptureResult = {
    outcome: "none",
    orderId: "ORDER-1",
    units: [],
    error: { name: "UNPROCESSABLE_ENTITY", message: "declined", details: [{ issue: "INSTRUMENT_DECLINED" }] },
    raw: undefined,
  };

  it("bumps capture_attempts with a compare-and-set before calling PayPal", async () => {
    const db = setup({ cart: { id: CART, buyer_user_id: BUYER, status: "checkout", capture_attempts: 2 } });
    vi.mocked(captureOrder).mockResolvedValue(completed);
    await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    const bump = db.queries.find((q) => q.table === "carts" && q.action === "update");
    expect(bump?.payload).toEqual({ capture_attempts: 3 });
    expect(eqValue(bump!, "id")).toBe(CART);
    expect(eqValue(bump!, "capture_attempts")).toBe(2);
    expect(captureOrder).toHaveBeenCalledWith("ORDER-1", { requestId: `capture:${CART}:3` });
  });

  it("sends a different request id when a declined capture is retried", async () => {
    setup({ cart: { id: CART, buyer_user_id: BUYER, status: "checkout", capture_attempts: 0 } });
    vi.mocked(captureOrder).mockResolvedValueOnce(declined);
    await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    setup({ cart: { id: CART, buyer_user_id: BUYER, status: "checkout", capture_attempts: 1 } });
    vi.mocked(captureOrder).mockResolvedValueOnce(completed);
    await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    const ids = vi.mocked(captureOrder).mock.calls.map((call) => call[1].requestId);
    expect(ids).toEqual([`capture:${CART}:1`, `capture:${CART}:2`]);
  });

  it("409s without calling PayPal when another attempt took the count first", async () => {
    setup({ bump: "no_row" });
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "capture_in_progress" });
    expect(captureOrder).not.toHaveBeenCalled();
  });

  it("500s without calling PayPal when the bump fails", async () => {
    setup({ bump: "error" });
    const response = await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(response.status).toBe(500);
    expect(captureOrder).not.toHaveBeenCalled();
  });

  it("reads the order when PayPal says it was already captured (a replay)", async () => {
    const db = setup({ cart: { id: CART, buyer_user_id: BUYER, status: "paid", capture_attempts: 1 } });
    vi.mocked(captureOrder).mockResolvedValue({
      ...declined,
      error: { name: "UNPROCESSABLE_ENTITY", message: "done", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] },
    });
    vi.mocked(resolveTimedOutCapture).mockResolvedValue(completed);
    const body = await (await POST(jsonRequest(URL_, { orderId: "ORDER-1" }))).json();
    expect(resolveTimedOutCapture).toHaveBeenCalledWith("ORDER-1");
    expect(body.outcome).toBe("completed");
    expect(db.rpcs).toHaveLength(1);
  });

  it("does not read the order after a plain decline", async () => {
    setup();
    vi.mocked(captureOrder).mockResolvedValue(declined);
    await POST(jsonRequest(URL_, { orderId: "ORDER-1" }));
    expect(resolveTimedOutCapture).not.toHaveBeenCalled();
  });
});
