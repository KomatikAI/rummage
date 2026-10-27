import {
  HOLD_MINUTES,
  type Cart,
  type CartLine,
  type HoldResult,
  type ItemsRepo,
  type ItemStatus,
  type ReleaseResult,
  type SearchItemsArgs,
  type ShopItem,
} from "@/lib/ai/shopping-tools";
import type { RummageClient } from "@/lib/supabase/server";
import {
  HOLD_ITEM_RESULTS,
  RELEASE_HOLD_RESULTS,
  type ItemStatus as DbItemStatus,
  type HoldItemResult,
  type PublicListingRow,
  type ReleaseHoldResult,
} from "@/lib/supabase/types";

import { isUuid } from "./auth";
import { queryFailed, RepoError, type DbError } from "./errors";

/**
 * `ItemsRepo` over Supabase, scoped to one sale and running as the signed-in buyer.
 *
 * - search reads the `public_listings` view (listed, held and sold items; jittered pins).
 * - hold / release go through the `hold_item` / `release_hold` RPCs. Both return a text
 *   reason and never raise for a refusal; the repo maps it straight to the result type.
 * - the cart is read from `carts` + `cart_lines` (buyer RLS) and the item details from
 *   `public_listings`, because buyers have no row access to `items` or `households`.
 *
 * Prices are numeric US dollars in the database and in the repo types.
 */

export interface SupabaseItemsRepoOptions {
  /** The sale every search is limited to. */
  saleId: string;
  /** Most items one search returns. Default 20. */
  searchLimit?: number;
  /** Clock, for tests. */
  now?: () => Date;
}

/** Rows read from the view before scoring; the scored list is cut to `searchLimit`. */
export const SEARCH_FETCH_LIMIT = 100;
export const DEFAULT_SEARCH_LIMIT = 20;
const TEXT_FIELDS = ["title", "description", "category"] as const;
const MAX_TOKENS = 6;

const STOPWORDS = new Set([
  "a", "an", "and", "any", "anything", "are", "about", "at", "but", "buy", "by",
  "cheap", "dollar", "dollars", "find", "for", "from", "get", "good", "have", "i",
  "in", "is", "it", "item", "items", "like", "looking", "me", "my", "need", "nice",
  "of", "on", "or", "over", "please", "price", "show", "some", "something", "than",
  "that", "the", "thing", "things", "to", "under", "want", "with",
]);

/**
 * Splits a free-text query into match tokens: lowercase letters and digits only (so no
 * PostgREST filter syntax can get through), stopwords and bare numbers dropped, a
 * trailing plural "s" trimmed ("chairs" matches "chair"), at most six tokens.
 */
export function searchTokens(query: string): string[] {
  const out: string[] = [];
  for (const raw of query.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOPWORDS.has(raw) || /^\p{N}+$/u.test(raw)) continue;
    const token = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (!out.includes(token)) out.push(token);
    if (out.length === MAX_TOKENS) break;
  }
  return out;
}

/** Maps a database item status to the buyer-facing one; null for states buyers never see. */
export function toShopStatus(status: DbItemStatus): ItemStatus | null {
  switch (status) {
    case "listed":
      return "available";
    case "held":
      return "held";
    case "sold":
    case "collected":
    case "cash_sold":
      return "sold";
    default:
      return null;
  }
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between two [lng, lat] points. */
export function distanceMetres(a: [number, number], b: [number, number]): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

const STATUS_RANK: Record<ItemStatus, number> = { available: 0, held: 1, sold: 2 };

type ListingSearchRow = Pick<
  PublicListingRow,
  | "item_id"
  | "household_label"
  | "public_lng"
  | "public_lat"
  | "title"
  | "description"
  | "category"
  | "price"
  | "status"
>;

function score(row: ListingSearchRow, tokens: string[]): number {
  const title = row.title.toLowerCase();
  const description = (row.description ?? "").toLowerCase();
  const category = row.category.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (title.includes(token)) total += 3;
    if (category.includes(token)) total += 2;
    if (description.includes(token)) total += 1;
  }
  return total;
}

/** hold_item's reasons, folded into the buyer-facing refusal set. */
export function toHoldRefusal(
  result: Exclude<HoldItemResult, "held">,
): Extract<HoldResult, { ok: false }>["reason"] {
  switch (result) {
    case "not_found":
    case "already_held":
    case "sold":
      return result;
    case "not_allowed":
    case "cart_not_open":
    case "own_item":
    case "seller_not_ready":
    case "cap_reached":
      return "not_allowed";
  }
}

/** release_hold's reasons, folded into the buyer-facing refusal set. */
export function toReleaseRefusal(
  result: Exclude<ReleaseHoldResult, "released">,
): Extract<ReleaseResult, { ok: false }>["reason"] {
  switch (result) {
    case "not_found":
      return "not_found";
    case "not_held":
    case "not_allowed":
    case "cart_not_open":
      return "not_held_by_cart";
  }
}

function isHoldItemResult(value: unknown): value is HoldItemResult {
  return (HOLD_ITEM_RESULTS as readonly unknown[]).includes(value);
}

function isReleaseHoldResult(value: unknown): value is ReleaseHoldResult {
  return (RELEASE_HOLD_RESULTS as readonly unknown[]).includes(value);
}

/** RPC errors that mean "this id can never be held/released", as opposed to an outage. */
function rpcRefusal(error: DbError): "not_found" | "not_allowed" | null {
  if (error.code === "22P02") return "not_found"; // invalid uuid text
  if (error.code === "42501") return "not_allowed"; // no EXECUTE / RLS refusal
  return null;
}

export class SupabaseItemsRepo implements ItemsRepo {
  private readonly db: RummageClient;
  private readonly saleId: string;
  private readonly searchLimit: number;
  private readonly now: () => Date;

  constructor(db: RummageClient, options: SupabaseItemsRepoOptions) {
    this.db = db;
    this.saleId = options.saleId;
    this.searchLimit = options.searchLimit ?? DEFAULT_SEARCH_LIMIT;
    this.now = options.now ?? (() => new Date());
  }

  async searchItems(args: SearchItemsArgs): Promise<ShopItem[]> {
    let query = this.db
      .from("public_listings")
      .select(
        "item_id, household_label, public_lng, public_lat, title, description, category, price, status",
      )
      .eq("sale_id", this.saleId);
    if (args.category !== undefined) query = query.eq("category", args.category);
    if (args.maxPrice !== undefined) query = query.lte("price", args.maxPrice);

    const tokens = searchTokens(args.query);
    if (tokens.length > 0) {
      query = query.or(
        tokens.flatMap((token) => TEXT_FIELDS.map((field) => `${field}.ilike.%${token}%`)).join(","),
      );
    }

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .limit(SEARCH_FETCH_LIMIT);
    if (error) throw queryFailed("searchItems", error);

    const near = args.nearLngLat;
    const radius = near ? args.radiusM : undefined;
    const scored: { item: ShopItem; score: number }[] = [];
    for (const row of data ?? []) {
      const status = toShopStatus(row.status);
      if (status === null || row.price === null) continue;
      let distanceM: number | null = null;
      if (near && row.public_lng !== null && row.public_lat !== null) {
        distanceM = Math.round(distanceMetres(near, [row.public_lng, row.public_lat]));
      }
      if (radius !== undefined && (distanceM === null || distanceM > radius)) continue;
      const item: ShopItem = {
        id: row.item_id,
        title: row.title,
        description: row.description,
        category: row.category,
        price: Number(row.price),
        status,
        householdName: row.household_label,
      };
      if (near) item.distanceM = distanceM;
      scored.push({ item, score: score(row, tokens) });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        STATUS_RANK[a.item.status] - STATUS_RANK[b.item.status] ||
        (a.item.distanceM ?? Infinity) - (b.item.distanceM ?? Infinity) ||
        a.item.price - b.item.price,
    );
    return scored.slice(0, this.searchLimit).map((entry) => entry.item);
  }

  async holdItem(itemId: string, cartId: string): Promise<HoldResult> {
    if (!isUuid(itemId)) return { ok: false, itemId, reason: "not_found" };
    if (!isUuid(cartId)) return { ok: false, itemId, reason: "not_allowed" };

    const { data, error } = await this.db.rpc("hold_item", { p_item: itemId, p_cart: cartId });
    if (error) {
      const reason = rpcRefusal(error);
      if (reason) return { ok: false, itemId, reason };
      throw queryFailed("holdItem", error);
    }
    if (!isHoldItemResult(data)) {
      throw new RepoError("query_failed", "holdItem", `unexpected hold_item result ${JSON.stringify(data)}`);
    }
    if (data === "held") {
      return { ok: true, itemId, cartId, expiresAt: await this.holdExpiry(itemId, cartId) };
    }
    return { ok: false, itemId, reason: toHoldRefusal(data) };
  }

  async releaseHold(itemId: string, cartId: string): Promise<ReleaseResult> {
    if (!isUuid(itemId)) return { ok: false, itemId, reason: "not_found" };
    if (!isUuid(cartId)) return { ok: false, itemId, reason: "not_held_by_cart" };

    const { data, error } = await this.db.rpc("release_hold", { p_item: itemId, p_cart: cartId });
    if (error) {
      const reason = rpcRefusal(error);
      if (reason === "not_found") return { ok: false, itemId, reason: "not_found" };
      if (reason === "not_allowed") return { ok: false, itemId, reason: "not_held_by_cart" };
      throw queryFailed("releaseHold", error);
    }
    if (!isReleaseHoldResult(data)) {
      throw new RepoError(
        "query_failed",
        "releaseHold",
        `unexpected release_hold result ${JSON.stringify(data)}`,
      );
    }
    if (data === "released") return { ok: true, itemId, cartId };
    return { ok: false, itemId, reason: toReleaseRefusal(data) };
  }

  async getCart(cartId: string): Promise<Cart> {
    if (!isUuid(cartId)) {
      throw new RepoError("cart_not_found", "getCart", "cart id is not a uuid");
    }
    const { data: cart, error: cartError } = await this.db
      .from("carts")
      .select("id, sale_id, status")
      .eq("id", cartId)
      .maybeSingle();
    if (cartError) throw queryFailed("getCart", cartError);
    // RLS shows a buyer only their own carts, so "not visible" and "missing" are the same.
    if (!cart) throw new RepoError("cart_not_found", "getCart", "no such cart for this buyer");

    const { data: lines, error: linesError } = await this.db
      .from("cart_lines")
      .select("item_id, price, hold_expires_at, created_at")
      .eq("cart_id", cartId)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (linesError) throw queryFailed("getCart", linesError);

    // An open cart's hold ends at hold_expires_at even before the sweep runs; a checkout
    // cart keeps its holds while the buyer is at PayPal.
    const nowMs = this.now().getTime();
    const live = (lines ?? []).filter(
      (line) => cart.status !== "open" || Date.parse(line.hold_expires_at) > nowMs,
    );

    const details = new Map<string, { title: string; householdName: string }>();
    if (live.length > 0) {
      const { data: listings, error: listingsError } = await this.db
        .from("public_listings")
        .select("item_id, title, household_label")
        .in(
          "item_id",
          live.map((line) => line.item_id),
        );
      if (listingsError) throw queryFailed("getCart", listingsError);
      for (const row of listings ?? []) {
        details.set(row.item_id, { title: row.title, householdName: row.household_label });
      }
    }

    const cartLines: CartLine[] = live.map((line) => {
      const detail = details.get(line.item_id);
      return {
        itemId: line.item_id,
        // The listing can drop out of the public view (household paused, item flagged)
        // while the line is still held; keep the line so the subtotal stays true.
        title: detail?.title ?? "Item no longer listed",
        price: Number(line.price),
        householdName: detail?.householdName ?? "Unknown household",
        holdExpiresAt: line.hold_expires_at,
      };
    });

    return {
      cartId,
      lines: cartLines,
      subtotal: roundCents(cartLines.reduce((sum, line) => sum + line.price, 0)),
    };
  }

  private async holdExpiry(itemId: string, cartId: string): Promise<string> {
    const { data, error } = await this.db
      .from("cart_lines")
      .select("hold_expires_at")
      .eq("cart_id", cartId)
      .eq("item_id", itemId)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) {
      // The hold is placed; only the read-back failed. hold_item always sets now() + 15 min.
      return new Date(this.now().getTime() + HOLD_MINUTES * 60_000).toISOString();
    }
    return data.hold_expires_at;
  }
}
