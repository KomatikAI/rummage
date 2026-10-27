import type { ItemCategory, ItemCondition, PublicListingRow } from "@/lib/supabase/types";

/**
 * Pure helpers for the public sale page: the item view model, client-side filtering,
 * sold-last ordering, category chips and one map pin per household.
 */

export type BrowseStatus = "available" | "held" | "sold";

/** One item as the sale page shows it. Prices are dollars. */
export type SaleItem = {
  id: string;
  title: string;
  description: string | null;
  category: ItemCategory;
  condition: ItemCondition;
  price: number | null;
  status: BrowseStatus;
  /** The household can be paid at checkout (households.paypal_status = ready). */
  acceptsPayments: boolean;
  householdId: string;
  householdLabel: string;
  /** Jittered household position, never the exact one. */
  lng: number | null;
  lat: number | null;
  photoUrl: string | null;
};

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  kids: "Kids",
  furniture: "Furniture",
  kitchen: "Kitchen",
  garden: "Garden",
  books: "Books",
  sports: "Sports",
  clothing: "Clothing",
  electronics: "Electronics",
  tools: "Tools",
  decor: "Decor",
  other: "Other",
};

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "Well used",
};

/** The demo sale the shell links to as /sale/demo. */
export const DEMO_SALE_SLUG = "maple-street-pta-spring-rummage";

const PHOTO_BUCKET = "item-photos";

/** Public URL of an item photo in the public `item-photos` bucket, or null without a path. */
export function photoUrl(supabaseUrl: string, photoPath: string | null): string | null {
  if (!photoPath) return null;
  const base = supabaseUrl.replace(/\/+$/, "");
  const path = photoPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/** public_listings.status to what a buyer sees. */
export function toBrowseStatus(status: PublicListingRow["status"]): BrowseStatus {
  switch (status) {
    case "listed":
      return "available";
    case "held":
      return "held";
    case "sold":
      return "sold";
  }
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toSaleItem(row: PublicListingRow, supabaseUrl: string): SaleItem {
  return {
    id: row.item_id,
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.condition,
    price: toNumberOrNull(row.price),
    status: toBrowseStatus(row.status),
    acceptsPayments: row.accepts_paypal,
    householdId: row.household_id,
    householdLabel: row.household_label,
    lng: toNumberOrNull(row.public_lng),
    lat: toNumberOrNull(row.public_lat),
    photoUrl: photoUrl(supabaseUrl, row.photo_path),
  };
}

export type ListingFilter = {
  query?: string;
  category?: ItemCategory | null;
  householdId?: string | null;
};

function normalise(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

/** True when every word of the query appears in the title, description, category or household. */
export function matchesQuery(item: SaleItem, query: string): boolean {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalise(
    [item.title, item.description ?? "", CATEGORY_LABELS[item.category], item.householdLabel].join(" "),
  );
  return words.every((word) => haystack.includes(word));
}

const STATUS_ORDER: Record<BrowseStatus, number> = { available: 0, held: 1, sold: 2 };

/**
 * Filters by query, category and household, then puts sold items last. Within a status
 * the incoming order is kept (the query orders by household, then listing time).
 */
export function filterListings(items: readonly SaleItem[], filter: ListingFilter): SaleItem[] {
  const query = filter.query?.trim() ?? "";
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (filter.category && item.category !== filter.category) return false;
      if (filter.householdId && item.householdId !== filter.householdId) return false;
      return matchesQuery(item, query);
    })
    .sort((a, b) => STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] || a.index - b.index)
    .map(({ item }) => item);
}

/** The categories that have at least one item, in the schema's order. */
export function categoriesPresent(items: readonly SaleItem[]): ItemCategory[] {
  const present = new Set(items.map((item) => item.category));
  return (Object.keys(CATEGORY_LABELS) as ItemCategory[]).filter((category) => present.has(category));
}

export type HouseholdPin = {
  householdId: string;
  label: string;
  lng: number;
  lat: number;
  /** Items still for sale (available or held). */
  count: number;
};

/** One pin per household that has a public position, in first-seen order. */
export function householdPins(items: readonly SaleItem[]): HouseholdPin[] {
  const pins = new Map<string, HouseholdPin>();
  for (const item of items) {
    if (item.lng === null || item.lat === null) continue;
    let pin = pins.get(item.householdId);
    if (!pin) {
      pin = { householdId: item.householdId, label: item.householdLabel, lng: item.lng, lat: item.lat, count: 0 };
      pins.set(item.householdId, pin);
    }
    if (item.status !== "sold") pin.count += 1;
  }
  return [...pins.values()];
}

/** "1 item" / "3 items". */
export function itemCountLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}
