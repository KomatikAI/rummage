import { describe, expect, it } from "vitest";

import { HOLD_MINUTES } from "@/lib/ai/shopping-tools";

import { RepoError } from "./errors";
import {
  distanceMetres,
  searchTokens,
  SupabaseItemsRepo,
  toShopStatus,
} from "./items-repo";
import {
  CART_ID,
  FakeSupabase,
  itemId,
  listing,
  OTHER_SALE_ID,
  SALE_ID,
  type FakeRow,
} from "./test-utils";

const NOW = new Date("2026-10-27T12:00:00Z");

function setup(listings: FakeRow[] = [], extra: Record<string, FakeRow[]> = {}) {
  const fake = new FakeSupabase({ tables: { public_listings: listings, ...extra } });
  const repo = new SupabaseItemsRepo(fake.client, { saleId: SALE_ID, now: () => NOW });
  return { fake, repo };
}

describe("searchTokens", () => {
  it("drops stopwords and numbers, trims plurals and strips filter syntax", () => {
    expect(searchTokens("Looking for wooden chairs under 20 dollars")).toEqual(["wooden", "chair"]);
    expect(searchTokens("lamp),title.eq.x,(*%")).toEqual(["lamp", "title", "eq"]);
    expect(searchTokens("glass")).toEqual(["glass"]);
    expect(searchTokens("a 5 the")).toEqual([]);
  });

  it("keeps at most six tokens", () => {
    expect(searchTokens("one two three four five six seven eight")).toHaveLength(6);
  });
});

describe("toShopStatus", () => {
  it("maps database states to buyer states", () => {
    expect(toShopStatus("listed")).toBe("available");
    expect(toShopStatus("held")).toBe("held");
    expect(toShopStatus("sold")).toBe("sold");
    expect(toShopStatus("collected")).toBe("sold");
    expect(toShopStatus("cash_sold")).toBe("sold");
    expect(toShopStatus("draft")).toBeNull();
    expect(toShopStatus("hidden")).toBeNull();
  });
});

describe("distanceMetres", () => {
  it("is about 111 km per degree of latitude", () => {
    expect(distanceMetres([0, 0], [0, 1])).toBeGreaterThan(111_000);
    expect(distanceMetres([0, 0], [0, 1])).toBeLessThan(111_400);
  });
});

describe("SupabaseItemsRepo.searchItems", () => {
  const rows = [
    listing(1, { title: "Wooden chair", category: "furniture", price: 15 }),
    listing(2, { title: "Kids bike", category: "kids", price: 30, status: "held" }),
    listing(3, { title: "Desk lamp", description: "Works, with a wooden base", price: 8 }),
    listing(4, { title: "Wooden spoon set", category: "kitchen", price: 2, status: "sold" }),
    listing(5, { title: "Wooden chair", sale_id: OTHER_SALE_ID }),
  ];

  it("reads public_listings scoped to the sale and maps rows to ShopItems", async () => {
    const { fake, repo } = setup(rows);
    const items = await repo.searchItems({ query: "wooden chair" });

    expect(items.map((i) => i.id)).toEqual([itemId(1), itemId(4), itemId(3)]);
    expect(items[0]).toEqual({
      id: itemId(1),
      title: "Wooden chair",
      description: null,
      category: "furniture",
      price: 15,
      status: "available",
      householdName: "The Alvarez table",
    });
    expect(items[1].status).toBe("sold");
    const [call] = fake.callsTo("public_listings");
    expect(call.filters).toContain(`eq:sale_id:"${SALE_ID}"`);
    expect(call.filters).toContainEqual(
      expect.stringMatching(/^or:title\.ilike\.%wooden%,description\.ilike\.%wooden%/),
    );
  });

  it("applies the category filter", async () => {
    const { fake, repo } = setup(rows);
    const items = await repo.searchItems({ query: "wooden", category: "kitchen" });
    expect(items.map((i) => i.id)).toEqual([itemId(4)]);
    expect(fake.calls[0].filters).toContain('eq:category:"kitchen"');
  });

  it("applies the max price in dollars", async () => {
    const { fake, repo } = setup(rows);
    const items = await repo.searchItems({ query: "wooden", maxPrice: 10 });
    expect(items.map((i) => i.id)).toEqual([itemId(4), itemId(3)]);
    expect(fake.calls[0].filters).toContain("lte:price:10");
  });

  it("returns everything in the sale when the query has no usable words", async () => {
    const { fake, repo } = setup(rows);
    const items = await repo.searchItems({ query: "anything" });
    expect(items).toHaveLength(4);
    expect(fake.calls[0].filters.some((f) => f.startsWith("or:"))).toBe(false);
  });

  it("ranks available before held before sold at equal relevance", async () => {
    const { repo } = setup([
      listing(1, { title: "Lamp", status: "sold" }),
      listing(2, { title: "Lamp", status: "held" }),
      listing(3, { title: "Lamp", status: "listed" }),
    ]);
    const items = await repo.searchItems({ query: "lamp" });
    expect(items.map((i) => i.status)).toEqual(["available", "held", "sold"]);
  });

  it("filters by radius around nearLngLat and reports distance", async () => {
    const { repo } = setup([
      listing(1, { title: "Lamp", public_lng: -90.29, public_lat: 38.64 }),
      listing(2, { title: "Lamp", public_lng: -90.29, public_lat: 38.66 }),
      listing(3, { title: "Lamp", public_lng: null, public_lat: null }),
    ]);
    const near = await repo.searchItems({
      query: "lamp",
      nearLngLat: [-90.29, 38.641],
      radiusM: 500,
    });
    expect(near.map((i) => i.id)).toEqual([itemId(1)]);
    expect(near[0].distanceM).toBeGreaterThan(100);
    expect(near[0].distanceM).toBeLessThan(120);

    const all = await repo.searchItems({ query: "lamp", nearLngLat: [-90.29, 38.641] });
    expect(all.map((i) => i.distanceM === null)).toEqual([false, false, true]);
  });

  it("caps results at searchLimit", async () => {
    const fake = new FakeSupabase({
      tables: { public_listings: Array.from({ length: 30 }, (_, n) => listing(n + 1, { title: "Lamp" })) },
    });
    const repo = new SupabaseItemsRepo(fake.client, { saleId: SALE_ID, searchLimit: 5 });
    await expect(repo.searchItems({ query: "lamp" })).resolves.toHaveLength(5);
  });

  it("throws a RepoError when the view read fails", async () => {
    const { fake, repo } = setup(rows);
    fake.failNext("public_listings", "select", { code: "57014", message: "timeout" });
    await expect(repo.searchItems({ query: "lamp" })).rejects.toBeInstanceOf(RepoError);
  });
});

describe("SupabaseItemsRepo.holdItem", () => {
  const ITEM = itemId(1);

  it("returns ok with the hold's expiry from cart_lines", async () => {
    const { fake, repo } = setup([listing(1)], {
      cart_lines: [
        { cart_id: CART_ID, item_id: ITEM, active: true, hold_expires_at: "2026-10-27T12:15:00Z" },
      ],
    });
    fake.rpcHandlers.hold_item = () => ({ data: true, error: null });

    await expect(repo.holdItem(ITEM, CART_ID)).resolves.toEqual({
      ok: true,
      itemId: ITEM,
      cartId: CART_ID,
      expiresAt: "2026-10-27T12:15:00Z",
    });
    expect(fake.calls[0]).toMatchObject({
      kind: "rpc",
      table: "hold_item",
      args: { p_item: ITEM, p_cart: CART_ID },
    });
  });

  it("falls back to now + HOLD_MINUTES when the expiry read-back fails", async () => {
    const { fake, repo } = setup([listing(1)]);
    fake.rpcHandlers.hold_item = () => ({ data: true, error: null });
    const result = await repo.holdItem(ITEM, CART_ID);
    expect(result).toMatchObject({
      ok: true,
      expiresAt: new Date(NOW.getTime() + HOLD_MINUTES * 60_000).toISOString(),
    });
  });

  it.each([
    ["sold", "sold"],
    ["held", "already_held"],
    ["listed", "not_allowed"],
  ] as const)("maps a refused hold on a %s listing to %s", async (status, reason) => {
    const { fake, repo } = setup([listing(1, { status })], { cart_lines: [] });
    fake.rpcHandlers.hold_item = () => ({ data: false, error: null });
    await expect(repo.holdItem(ITEM, CART_ID)).resolves.toEqual({ ok: false, itemId: ITEM, reason });
  });

  it("maps a refused hold on an item this cart already holds to not_allowed (cart not open)", async () => {
    const { fake, repo } = setup([listing(1, { status: "held" })], {
      cart_lines: [{ cart_id: CART_ID, item_id: ITEM, active: true, hold_expires_at: "x" }],
    });
    fake.rpcHandlers.hold_item = () => ({ data: false, error: null });
    await expect(repo.holdItem(ITEM, CART_ID)).resolves.toMatchObject({ reason: "not_allowed" });
  });

  it("maps an item that is not listed in this sale to not_found", async () => {
    const { fake, repo } = setup([listing(1, { sale_id: OTHER_SALE_ID })]);
    fake.rpcHandlers.hold_item = () => ({ data: false, error: null });
    await expect(repo.holdItem(ITEM, CART_ID)).resolves.toMatchObject({ reason: "not_found" });

    const empty = setup([]);
    empty.fake.rpcHandlers.hold_item = () => ({ data: false, error: null });
    await expect(empty.repo.holdItem(ITEM, CART_ID)).resolves.toMatchObject({
      reason: "not_found",
    });
  });

  it("refuses a non-uuid item id without calling the RPC", async () => {
    const { fake, repo } = setup();
    await expect(repo.holdItem("lamp-1", CART_ID)).resolves.toEqual({
      ok: false,
      itemId: "lamp-1",
      reason: "not_found",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("maps RPC error codes: 22P02 -> not_found, 42501 -> not_allowed, others throw", async () => {
    const { fake, repo } = setup();
    fake.rpcHandlers.hold_item = () => ({ data: true, error: null });
    fake.failNext("hold_item", "rpc", { code: "22P02", message: "invalid input syntax for type uuid" });
    await expect(repo.holdItem(ITEM, CART_ID)).resolves.toMatchObject({ reason: "not_found" });
    fake.failNext("hold_item", "rpc", { code: "42501", message: "permission denied for function hold_item" });
    await expect(repo.holdItem(ITEM, CART_ID)).resolves.toMatchObject({ reason: "not_allowed" });
    fake.failNext("hold_item", "rpc", { code: "08006", message: "connection failure" });
    await expect(repo.holdItem(ITEM, CART_ID)).rejects.toBeInstanceOf(RepoError);
  });
});

describe("SupabaseItemsRepo.releaseHold", () => {
  const ITEM = itemId(1);

  it("returns ok when the RPC released the hold", async () => {
    const { fake, repo } = setup([listing(1, { status: "held" })]);
    fake.rpcHandlers.release_hold = () => ({ data: true, error: null });
    await expect(repo.releaseHold(ITEM, CART_ID)).resolves.toEqual({
      ok: true,
      itemId: ITEM,
      cartId: CART_ID,
    });
    expect(fake.calls[0]).toMatchObject({ table: "release_hold", args: { p_item: ITEM, p_cart: CART_ID } });
  });

  it("maps a refused release on a listed item to not_held_by_cart", async () => {
    const { fake, repo } = setup([listing(1, { status: "held" })]);
    fake.rpcHandlers.release_hold = () => ({ data: false, error: null });
    await expect(repo.releaseHold(ITEM, CART_ID)).resolves.toEqual({
      ok: false,
      itemId: ITEM,
      reason: "not_held_by_cart",
    });
  });

  it("maps a refused release on an unknown item to not_found", async () => {
    const { fake, repo } = setup([]);
    fake.rpcHandlers.release_hold = () => ({ data: false, error: null });
    await expect(repo.releaseHold(ITEM, CART_ID)).resolves.toMatchObject({ reason: "not_found" });
    await expect(repo.releaseHold("nope", CART_ID)).resolves.toMatchObject({ reason: "not_found" });
  });

  it("maps RPC error codes and throws on outages", async () => {
    const { fake, repo } = setup();
    fake.failNext("release_hold", "rpc", { code: "22P02", message: "bad uuid" });
    await expect(repo.releaseHold(ITEM, CART_ID)).resolves.toMatchObject({ reason: "not_found" });
    fake.failNext("release_hold", "rpc", { code: "42501", message: "denied" });
    await expect(repo.releaseHold(ITEM, CART_ID)).resolves.toMatchObject({
      reason: "not_held_by_cart",
    });
    fake.failNext("release_hold", "rpc", { code: "08006", message: "down" });
    await expect(repo.releaseHold(ITEM, CART_ID)).rejects.toBeInstanceOf(RepoError);
  });
});

describe("SupabaseItemsRepo.getCart", () => {
  const cart = (status: string) => ({ id: CART_ID, sale_id: SALE_ID, status });
  const line = (n: number, overrides: FakeRow = {}) => ({
    cart_id: CART_ID,
    item_id: itemId(n),
    household_id: "b1",
    price: 2.5,
    hold_expires_at: "2026-10-27T12:10:00Z",
    active: true,
    created_at: `2026-10-27T11:5${n}:00Z`,
    ...overrides,
  });

  it("assembles active lines with listing details and a cents-rounded subtotal", async () => {
    const { repo } = setup(
      [
        listing(1, { title: "Lamp", household_label: "Oak corner", status: "held" }),
        listing(2, { title: "Mug", status: "held" }),
      ],
      {
        carts: [cart("open")],
        cart_lines: [
          line(1, { price: 0.1 }),
          line(2, { price: 0.2 }),
          line(3, { active: false }),
          { ...line(4), cart_id: "c0000000-0000-4000-8000-000000000002" },
        ],
      },
    );
    await expect(repo.getCart(CART_ID)).resolves.toEqual({
      cartId: CART_ID,
      lines: [
        {
          itemId: itemId(1),
          title: "Lamp",
          price: 0.1,
          householdName: "Oak corner",
          holdExpiresAt: "2026-10-27T12:10:00Z",
        },
        {
          itemId: itemId(2),
          title: "Mug",
          price: 0.2,
          householdName: "The Alvarez table",
          holdExpiresAt: "2026-10-27T12:10:00Z",
        },
      ],
      subtotal: 0.3,
    });
  });

  it("drops expired holds from an open cart but keeps them at checkout", async () => {
    const lines = [line(1), line(2, { hold_expires_at: "2026-10-27T11:59:00Z" })];
    const open = setup([listing(1), listing(2)], { carts: [cart("open")], cart_lines: lines });
    await expect(open.repo.getCart(CART_ID)).resolves.toMatchObject({
      lines: [{ itemId: itemId(1) }],
      subtotal: 2.5,
    });

    const checkout = setup([listing(1), listing(2)], {
      carts: [cart("checkout")],
      cart_lines: lines,
    });
    await expect(checkout.repo.getCart(CART_ID)).resolves.toMatchObject({ subtotal: 5 });
  });

  it("keeps a held line whose listing left the public view", async () => {
    const { repo } = setup([], { carts: [cart("open")], cart_lines: [line(1)] });
    await expect(repo.getCart(CART_ID)).resolves.toMatchObject({
      lines: [{ title: "Item no longer listed", householdName: "Unknown household", price: 2.5 }],
    });
  });

  it("returns an empty cart without reading listings", async () => {
    const { fake, repo } = setup([], { carts: [cart("open")], cart_lines: [] });
    await expect(repo.getCart(CART_ID)).resolves.toEqual({ cartId: CART_ID, lines: [], subtotal: 0 });
    expect(fake.callsTo("public_listings")).toHaveLength(0);
  });

  it("throws cart_not_found for a cart the buyer cannot see or a non-uuid id", async () => {
    const { repo } = setup([], { carts: [] });
    await expect(repo.getCart(CART_ID)).rejects.toMatchObject({ code: "cart_not_found" });
    await expect(repo.getCart("mine")).rejects.toMatchObject({ code: "cart_not_found" });
  });

  it("throws query_failed when a read fails", async () => {
    const { fake, repo } = setup([], { carts: [cart("open")], cart_lines: [] });
    fake.failNext("cart_lines", "select", { message: "boom" });
    await expect(repo.getCart(CART_ID)).rejects.toMatchObject({ code: "query_failed" });
  });
});
