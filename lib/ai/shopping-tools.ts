import { tool } from "ai";
import { z } from "zod";
import { ListingCategory } from "./schemas";

/**
 * Shopping tools for the buyer assistant. Every tool goes through an injected
 * `ItemsRepo`, so the assistant only ever sees what the repo returns.
 *
 * There is deliberately no payment, checkout, order or capture tool: the
 * assistant can find and hold items, and the buyer pays on /buyer/cart with
 * PayPal themselves.
 */

/** Holds expire after this long; the repo enforces it, the prompt states it. */
export const HOLD_MINUTES = 15;

export type ItemStatus = "available" | "held" | "sold";

export interface ShopItem {
  id: string;
  title: string;
  description: string | null;
  category: ListingCategory;
  /** Asking price in US dollars. */
  price: number;
  status: ItemStatus;
  householdName: string;
  /** Distance from `nearLngLat` in metres, when the search used one. */
  distanceM?: number | null;
}

export interface SearchItemsArgs {
  query: string;
  maxPrice?: number;
  category?: ListingCategory;
  /** [longitude, latitude]. */
  nearLngLat?: [number, number];
  radiusM?: number;
}

export type HoldResult =
  | { ok: true; itemId: string; cartId: string; expiresAt: string }
  | {
      ok: false;
      itemId: string;
      reason: "not_found" | "already_held" | "sold" | "not_allowed";
    };

export type ReleaseResult =
  | { ok: true; itemId: string; cartId: string }
  | { ok: false; itemId: string; reason: "not_found" | "not_held_by_cart" };

export interface CartLine {
  itemId: string;
  title: string;
  price: number;
  householdName: string;
  holdExpiresAt: string;
}

export interface Cart {
  cartId: string;
  lines: CartLine[];
  /** Sum of line prices in US dollars. */
  subtotal: number;
}

/** Data access the shopping tools need. Implemented elsewhere (Supabase lane). */
export interface ItemsRepo {
  searchItems(args: SearchItemsArgs): Promise<ShopItem[]>;
  holdItem(itemId: string, cartId: string): Promise<HoldResult>;
  releaseHold(itemId: string, cartId: string): Promise<ReleaseResult>;
  getCart(cartId: string): Promise<Cart>;
}

export interface ShoppingToolsOptions {
  /** The buyer's cart. Fixed per session, never chosen by the model. */
  cartId: string;
}

export const searchItemsInput = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe("What the buyer is looking for, in plain words"),
  maxPrice: z
    .number()
    .positive()
    .optional()
    .describe("Highest price the buyer wants to pay, in US dollars"),
  category: ListingCategory.optional().describe("Limit to one category"),
  nearLngLat: z
    .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
    .optional()
    .describe("[longitude, latitude] to search around"),
  radiusM: z
    .number()
    .positive()
    .max(50_000)
    .optional()
    .describe("Search radius in metres around nearLngLat"),
});

export const itemIdInput = z.object({
  itemId: z.string().min(1).describe("The item id from search_items"),
});

export const emptyInput = z.object({});

/** Builds the four shopping tools bound to one repo and one cart. */
export function makeShoppingTools(repo: ItemsRepo, options: ShoppingToolsOptions) {
  const { cartId } = options;
  return {
    search_items: tool({
      description:
        "Search items for sale across every household in this sale. Returns id, title, price, status and household for each match.",
      inputSchema: searchItemsInput,
      execute: async (input) => {
        const args: SearchItemsArgs = { query: input.query };
        if (input.maxPrice !== undefined) args.maxPrice = input.maxPrice;
        if (input.category !== undefined) args.category = input.category;
        if (input.nearLngLat !== undefined) args.nearLngLat = input.nearLngLat;
        if (input.radiusM !== undefined) args.radiusM = input.radiusM;
        const items = await repo.searchItems(args);
        return { items };
      },
    }),
    hold_item: tool({
      description: `Hold one item in the buyer's cart for ${HOLD_MINUTES} minutes so nobody else can buy it. Holding is not paying. Only hold items the buyer asked for.`,
      inputSchema: itemIdInput,
      execute: async ({ itemId }) => repo.holdItem(itemId, cartId),
    }),
    release_hold: tool({
      description:
        "Release a hold this buyer's cart has on an item, making it available to others again.",
      inputSchema: itemIdInput,
      execute: async ({ itemId }) => repo.releaseHold(itemId, cartId),
    }),
    get_cart: tool({
      description:
        "Show the items held in the buyer's cart, with prices, households and when each hold expires.",
      inputSchema: emptyInput,
      execute: async () => repo.getCart(cartId),
    }),
  };
}

export type ShoppingTools = ReturnType<typeof makeShoppingTools>;

/** Tool names the shopping assistant may ever expose. */
export const SHOPPING_TOOL_NAMES = [
  "search_items",
  "hold_item",
  "release_hold",
  "get_cart",
] as const;
