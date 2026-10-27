import { describe, expect, it, vi } from "vitest";
import {
  itemIdInput,
  makeShoppingTools,
  searchItemsInput,
  SHOPPING_TOOL_NAMES,
  type Cart,
  type ItemsRepo,
  type ShopItem,
} from "./shopping-tools";
import { execOptions } from "./test-utils";

const item: ShopItem = {
  id: "item-1",
  title: "Kids bike, 16 inch",
  description: null,
  category: "kids",
  price: 20,
  status: "available",
  householdName: "The Parks",
};

const cart: Cart = {
  cartId: "cart-1",
  lines: [
    {
      itemId: "item-1",
      title: item.title,
      price: 20,
      householdName: "The Parks",
      holdExpiresAt: "2026-10-27T18:15:00Z",
    },
  ],
  subtotal: 20,
};

function fakeRepo() {
  return {
    searchItems: vi.fn(async () => [item]),
    holdItem: vi.fn(async (itemId: string, cartId: string) => ({
      ok: true as const,
      itemId,
      cartId,
      expiresAt: "2026-10-27T18:15:00Z",
    })),
    releaseHold: vi.fn(async (itemId: string, cartId: string) => ({
      ok: true as const,
      itemId,
      cartId,
    })),
    getCart: vi.fn(async () => cart),
  } satisfies ItemsRepo;
}

describe("makeShoppingTools", () => {
  it("exposes exactly the four shopping tools and nothing that pays", () => {
    const tools = makeShoppingTools(fakeRepo(), { cartId: "cart-1" });
    expect(Object.keys(tools).sort()).toEqual([...SHOPPING_TOOL_NAMES].sort());
    for (const name of Object.keys(tools)) {
      expect(name).not.toMatch(/pay|checkout|capture|order|refund|purchase|buy/i);
    }
  });

  it("search_items passes the parsed args to the repo", async () => {
    const repo = fakeRepo();
    const tools = makeShoppingTools(repo, { cartId: "cart-1" });
    const input = searchItemsInput.parse({
      query: "bike",
      maxPrice: 30,
      category: "kids",
      nearLngLat: [-83.0, 40.0],
      radiusM: 2000,
    });
    const result = await tools.search_items.execute!(input, execOptions);
    expect(repo.searchItems).toHaveBeenCalledWith({
      query: "bike",
      maxPrice: 30,
      category: "kids",
      nearLngLat: [-83.0, 40.0],
      radiusM: 2000,
    });
    expect(result).toEqual({ items: [item] });
  });

  it("search_items omits optional args the model did not send", async () => {
    const repo = fakeRepo();
    const tools = makeShoppingTools(repo, { cartId: "cart-1" });
    await tools.search_items.execute!({ query: "lamp" }, execOptions);
    expect(repo.searchItems).toHaveBeenCalledWith({ query: "lamp" });
  });

  it("search_items input schema rejects bad args", () => {
    const schema = searchItemsInput;
    expect(schema.safeParse({ query: "" }).success).toBe(false);
    expect(schema.safeParse({ query: "x", maxPrice: -5 }).success).toBe(false);
    expect(schema.safeParse({ query: "x", category: "toys" }).success).toBe(false);
    expect(schema.safeParse({ query: "x", nearLngLat: [200, 0] }).success).toBe(false);
  });

  it("hold_item and release_hold use the session cart, not a model-chosen one", async () => {
    const repo = fakeRepo();
    const tools = makeShoppingTools(repo, { cartId: "cart-1" });
    const injected = { itemId: "item-1", cartId: "someone-elses-cart" };
    const parsed = itemIdInput.parse(injected);
    expect(parsed).toEqual({ itemId: "item-1" });
    await tools.hold_item.execute!(parsed, execOptions);
    expect(repo.holdItem).toHaveBeenCalledWith("item-1", "cart-1");
    await tools.release_hold.execute!({ itemId: "item-1" }, execOptions);
    expect(repo.releaseHold).toHaveBeenCalledWith("item-1", "cart-1");
  });

  it("get_cart reads the session cart", async () => {
    const repo = fakeRepo();
    const tools = makeShoppingTools(repo, { cartId: "cart-1" });
    await expect(tools.get_cart.execute!({}, execOptions)).resolves.toEqual(cart);
    expect(repo.getCart).toHaveBeenCalledWith("cart-1");
  });

  it("states the 15-minute hold in the hold_item description", () => {
    const tools = makeShoppingTools(fakeRepo(), { cartId: "cart-1" });
    expect(tools.hold_item.description).toContain("15 minutes");
  });
});
