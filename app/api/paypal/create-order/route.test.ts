import { beforeEach, describe, expect, it, vi } from "vitest";

import { dbFail, eqValue, fakeDb, fakeSessionClient, jsonRequest, ok, type FakeQuery, type QueryResolver } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://rummage.test/" } }));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createMultiSellerOrder: vi.fn(),
}));

import { createMultiSellerOrder, PayPalApiError } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { POST } from "./route";

const URL_ = "https://rummage.test/api/paypal/create-order";
const CART = "c0000000-0000-4000-8000-000000000001";
const SALE = "a0000000-0000-4000-8000-000000000001";
const BUYER = "u0000000-0000-4000-8000-0000000000b1";
const H1 = "b0000000-0000-4000-8000-000000000001";
const H2 = "b0000000-0000-4000-8000-000000000002";

type Fixture = {
  cart?: Record<string, unknown> | null;
  claimed?: unknown[];
  sale?: Record<string, unknown>;
  lines?: unknown[];
  households?: unknown[];
  units?: unknown[];
};

function resolverFor(fixture: Fixture = {}): QueryResolver {
  return (q: FakeQuery) => {
    if (q.table === "carts" && q.action === "select") {
      return ok(fixture.cart === undefined ? { id: CART, buyer_user_id: BUYER, sale_id: SALE, status: "open" } : fixture.cart);
    }
    if (q.table === "carts" && q.action === "update" && (q.payload as { status?: string }).status === "checkout") {
      return ok(fixture.claimed ?? [{ id: CART }]);
    }
    if (q.table === "sales") {
      return ok(fixture.sale ?? { id: SALE, status: "open", fundraiser_name: null, organizer_merchant_id: null });
    }
    if (q.table === "cart_lines") {
      return ok(
        fixture.lines ?? [
          { item_id: "i1", household_id: H1, price: 17.5 },
          { item_id: "i2", household_id: H2, price: 5 },
        ],
      );
    }
    if (q.table === "households") {
      return ok(
        fixture.households ?? [
          { id: H1, label: "The Alvarez table", merchant_id_in_paypal: "MERCH1", paypal_status: "ready", paused: false },
          { id: H2, label: "Oak corner", merchant_id_in_paypal: "MERCH2", paypal_status: "ready", paused: false },
        ],
      );
    }
    if (q.table === "purchase_units" && q.action === "select") return ok(fixture.units ?? []);
    if (q.table === "items") {
      return ok([
        { id: "i1", title: "Cast iron pan" },
        { id: "i2", title: "Board game" },
      ]);
    }
    return undefined;
  };
}

function setup(fixture?: Fixture, userId: string | null = BUYER) {
  const db = fakeDb(resolverFor(fixture));
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(userId));
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

const reopened = (queries: FakeQuery[]) =>
  queries.some((q) => q.table === "carts" && q.action === "update" && (q.payload as { status?: string }).status === "open");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(createMultiSellerOrder).mockReset();
  vi.mocked(createMultiSellerOrder).mockResolvedValue({
    id: "ORDER-1",
    status: "PAYER_ACTION_REQUIRED",
    approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    links: [],
    raw: { id: "ORDER-1", status: "PAYER_ACTION_REQUIRED" },
  });
});

describe("POST /api/paypal/create-order validation and auth", () => {
  it("rejects a non-JSON body", async () => {
    setup();
    const response = await POST(jsonRequest(URL_, "{not json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("rejects a bad cart id and a negative donation", async () => {
    setup();
    expect((await POST(jsonRequest(URL_, { cartId: "nope" }))).status).toBe(400);
    const response = await POST(jsonRequest(URL_, { cartId: CART, donationCents: -1 }));
    expect(await response.json()).toMatchObject({ error: "invalid_body" });
  });

  it("requires a signed-in buyer", async () => {
    setup({}, null);
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("404s an unknown cart and 403s someone else's", async () => {
    setup({ cart: null });
    expect((await POST(jsonRequest(URL_, { cartId: CART }))).status).toBe(404);
    setup({ cart: { id: CART, buyer_user_id: "someone-else", sale_id: SALE, status: "open" } });
    expect((await POST(jsonRequest(URL_, { cartId: CART }))).status).toBe(403);
  });

  it("409s a cart waiting at checkout with canCancel, and never cancels it", async () => {
    const db = setup({ cart: { id: CART, buyer_user_id: BUYER, sale_id: SALE, status: "checkout" } });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cart_in_checkout", cartId: CART, canCancel: true });
    expect(db.queries.filter((q) => q.action !== "select")).toHaveLength(0);
    expect(createMultiSellerOrder).not.toHaveBeenCalled();
  });

  it("409s cart_not_open for a checkout whose capture has started", async () => {
    setup({
      cart: { id: CART, buyer_user_id: BUYER, sale_id: SALE, status: "checkout" },
      units: [{ capture_id: "CAP-1", capture_status: "PENDING" }],
    });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: "cart_not_open" });
    expect(body).not.toHaveProperty("canCancel");
  });

  it("409s a cart that is not open, or that another request claimed first", async () => {
    setup({ cart: { id: CART, buyer_user_id: BUYER, sale_id: SALE, status: "paid" } });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cart_not_open" });

    setup({ claimed: [] });
    expect((await POST(jsonRequest(URL_, { cartId: CART }))).status).toBe(409);
    expect(createMultiSellerOrder).not.toHaveBeenCalled();
  });
});

describe("POST /api/paypal/create-order checkout", () => {
  it("creates one unit per household, stores the order id and the pending units", async () => {
    const db = setup();
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId: "ORDER-1",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
    });

    const input = vi.mocked(createMultiSellerOrder).mock.calls[0][0];
    expect(input.units.map((unit) => [unit.referenceId, unit.merchantId, unit.amount, unit.customId])).toEqual([
      [H1, "MERCH1", "17.50", H1],
      [H2, "MERCH2", "5.00", H2],
    ]);
    expect(input.returnUrl).toBe(`https://rummage.test/buyer/cart?checkout=approved&cart=${CART}`);
    expect(input.requestId).toMatch(new RegExp(`^create-${CART}-`));

    const stamp = db.queries.find((q) => q.table === "carts" && q.action === "update" && "paypal_order_id" in (q.payload as object));
    expect(stamp?.payload).toEqual({ paypal_order_id: "ORDER-1" });
    const insert = db.queries.find((q) => q.table === "purchase_units" && q.action === "insert");
    expect(insert?.payload).toEqual([
      { cart_id: CART, household_id: H1, reference_id: H1, amount: 17.5, merchant_id: "MERCH1" },
      { cart_id: CART, household_id: H2, reference_id: H2, amount: 5, merchant_id: "MERCH2" },
    ]);
    // The cart is claimed with a status guard.
    const claim = db.queries.find((q) => q.table === "carts" && q.action === "update");
    expect(eqValue(claim!, "status")).toBe("open");
  });

  it("adds the donation unit for a fundraiser sale", async () => {
    const db = setup({ sale: { id: SALE, status: "open", fundraiser_name: "Forest Park PTA", organizer_merchant_id: "ORGMERCH" } });
    const response = await POST(jsonRequest(URL_, { cartId: CART, donationCents: 250 }));
    expect(response.status).toBe(200);
    const input = vi.mocked(createMultiSellerOrder).mock.calls[0][0];
    expect(input.units.at(-1)).toMatchObject({ referenceId: "donation", merchantId: "ORGMERCH", amount: "2.50" });
    const insert = db.queries.find((q) => q.table === "purchase_units" && q.action === "insert");
    expect((insert?.payload as unknown[]).at(-1)).toEqual({
      cart_id: CART,
      household_id: null,
      reference_id: "donation",
      amount: 2.5,
      merchant_id: "ORGMERCH",
    });
  });

  it("refuses a donation the sale cannot take and reopens the cart", async () => {
    const db = setup();
    const response = await POST(jsonRequest(URL_, { cartId: CART, donationCents: 100 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "donations_not_accepted" });
    expect(reopened(db.queries)).toBe(true);
  });

  it("enforces maxHouseholdsPerCart", async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `b0000000-0000-4000-8000-00000000001${index}`);
    const db = setup({
      sale: { id: SALE, status: "open", fundraiser_name: "PTA", organizer_merchant_id: "ORG" },
      lines: ids.map((id, index) => ({ item_id: `i${index}`, household_id: id, price: 1 })),
      households: ids.map((id) => ({ id, label: id, merchant_id_in_paypal: "M", paypal_status: "ready", paused: false })),
    });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "too_many_households" });
    expect(reopened(db.queries)).toBe(true);
    expect(createMultiSellerOrder).not.toHaveBeenCalled();
  });

  it("409s an empty cart and reopens it", async () => {
    const db = setup({ lines: [] });
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "cart_empty" });
    expect(reopened(db.queries)).toBe(true);
  });

  it("returns 502 with PayPal's debug id and reopens the cart when PayPal fails", async () => {
    const db = setup();
    vi.mocked(createMultiSellerOrder).mockRejectedValue(
      new PayPalApiError({
        status: 422,
        paypalName: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed.",
        debugId: "dbg-123",
        details: [{ issue: "PAYEE_ACCOUNT_INVALID" }],
        method: "POST",
        path: "/v2/checkout/orders",
      }),
    );
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "paypal_error", debugId: "dbg-123", issues: ["PAYEE_ACCOUNT_INVALID"] });
    expect(reopened(db.queries)).toBe(true);
    expect(db.queries.some((q) => q.table === "purchase_units")).toBe(false);
  });

  it("reopens the cart when the purchase units cannot be stored", async () => {
    const base = resolverFor();
    const db = fakeDb((q) => (q.table === "purchase_units" ? dbFail() : base(q)));
    vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeSessionClient(BUYER));
    vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(jsonRequest(URL_, { cartId: CART }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "database_error" });
    const reopen = db.queries.find((q) => q.table === "carts" && (q.payload as { status?: string } | undefined)?.status === "open");
    expect(reopen?.payload).toEqual({ status: "open", paypal_order_id: null });
  });
});
