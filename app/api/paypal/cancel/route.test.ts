import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, eqValue, fakeDb, fakeSessionClient, jsonRequest, ok, type FakeQuery } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const URL_ = "https://rummage.test/api/paypal/cancel";
const CART = "c0000000-0000-4000-8000-000000000001";
const BUYER = "u0000000-0000-4000-8000-0000000000b1";

const checkoutCart = { id: CART, buyer_user_id: BUYER, status: "checkout", paypal_order_id: "ORDER-1" };
const pendingUnits = [
  { capture_id: null, capture_status: null },
  { capture_id: null, capture_status: null },
];

type Fixture = {
  cart?: Record<string, unknown> | null;
  units?: unknown[];
  reopened?: unknown[];
  failDelete?: boolean;
};

function setup(fixture: Fixture = {}, userId: string | null = BUYER) {
  const db = fakeDb((q: FakeQuery) => {
    if (q.table === "carts" && q.action === "select") return ok(fixture.cart === undefined ? checkoutCart : fixture.cart);
    if (q.table === "carts" && q.action === "update") return ok(fixture.reopened ?? [{ id: CART }]);
    if (q.table === "purchase_units" && q.action === "select") return ok(fixture.units ?? pendingUnits);
    if (q.table === "purchase_units" && q.action === "delete") return fixture.failDelete ? dbFail() : ok(null);
    return undefined;
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

const writes = (queries: FakeQuery[]) => queries.filter((q) => q.action !== "select");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/paypal/cancel validation and auth", () => {
  it("rejects a bad body", async () => {
    setup();
    expect((await POST(jsonRequest(URL_, "{nope"))).status).toBe(400);
    const response = await POST(jsonRequest(URL_, { cartId: "not-a-uuid" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_body" });
  });

  it("requires a signed-in buyer", async () => {
    const db = setup({}, null);
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
    expect(db.queries).toHaveLength(0);
  });

  it("404s an unknown cart and 403s someone else's", async () => {
    setup({ cart: null });
    const missing = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "cart_not_found" });

    const db = setup({ cart: { ...checkoutCart, buyer_user_id: "someone-else" } });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
    expect(writes(db.queries)).toHaveLength(0);
  });
});

describe("POST /api/paypal/cancel refusals", () => {
  it("409s a cart that is not at checkout", async () => {
    for (const status of ["paid", "partial", "failed", "abandoned"]) {
      const db = setup({ cart: { ...checkoutCart, status } });
      const response = await POST(jsonRequest(URL_, { cartId: CART }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "cart_not_in_checkout" });
      expect(writes(db.queries)).toHaveLength(0);
    }
  });

  it("409s capture_started once any unit has a capture, and names the order", async () => {
    const db = setup({ units: [{ capture_id: null, capture_status: null }, { capture_id: "CAP-1", capture_status: "PENDING" }] });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "capture_started", orderId: "ORDER-1" });
    expect(writes(db.queries)).toHaveLength(0);
  });

  it("409s when the cart left checkout between the read and the reopen", async () => {
    setup({ reopened: [] });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cart_not_in_checkout" });
  });

  it("500s and leaves the cart alone when the units cannot be deleted", async () => {
    const db = setup({ failDelete: true });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "database_error" });
    expect(db.queries.some((q) => q.table === "carts" && q.action === "update")).toBe(false);
  });
});

describe("POST /api/paypal/cancel happy path", () => {
  it("deletes the pending units, then clears the order and reopens the cart", async () => {
    const db = setup();
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "open" });

    const changed = writes(db.queries);
    expect(changed.map((q) => [q.table, q.action])).toEqual([
      ["purchase_units", "delete"],
      ["carts", "update"],
    ]);
    const [remove, reopen] = changed;
    expect(eqValue(remove, "cart_id")).toBe(CART);
    expect(remove.filters).toContainEqual({ column: "capture_status", op: "is", value: null });
    expect(reopen.payload).toEqual({ status: "open", paypal_order_id: null });
    expect(eqValue(reopen, "id")).toBe(CART);
    expect(eqValue(reopen, "status")).toBe("checkout");
    // Holds stay: no cart line or item is touched.
    expect(db.queries.some((q) => q.table === "cart_lines" || q.table === "items")).toBe(false);
  });

  it("is idempotent: an open cart with no order answers 200 and writes nothing", async () => {
    const db = setup({ cart: { ...checkoutCart, status: "open", paypal_order_id: null }, units: [] });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "open" });
    expect(writes(db.queries)).toHaveLength(0);
  });
});
