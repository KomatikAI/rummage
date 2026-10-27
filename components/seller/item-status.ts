import type { ItemRow, ItemStatus } from "@/lib/supabase/types";

/** One section of the seller's item list. */
export type ItemGroupKey = "listed" | "held" | "sold" | "collected" | "cash_sold" | "unlisted";

export type ItemGroup<T> = { key: ItemGroupKey; title: string; hint: string; items: T[] };

/** Sections in the order a seller works through them on sale day. */
export const ITEM_GROUPS: readonly { key: ItemGroupKey; title: string; hint: string }[] = [
  { key: "sold", title: "Paid, waiting for pickup", hint: "Ask for the buyer's pickup code when they arrive." },
  { key: "held", title: "In a cart", hint: "Someone is checking out. It comes back if they do not pay." },
  { key: "listed", title: "For sale", hint: "Buyers can see these on the map." },
  { key: "unlisted", title: "Not listed", hint: "Only you can see these." },
  { key: "collected", title: "Picked up", hint: "Paid and handed over." },
  { key: "cash_sold", title: "Sold for cash", hint: "Recorded so the sale total stays right." },
];

export function groupKeyFor(status: ItemStatus): ItemGroupKey {
  switch (status) {
    case "draft":
    case "hidden":
      return "unlisted";
    default:
      return status;
  }
}

/** Groups items by status, keeping their order inside each group and dropping empty groups. */
export function groupItemsByStatus<T extends Pick<ItemRow, "status">>(items: readonly T[]): ItemGroup<T>[] {
  const buckets = new Map<ItemGroupKey, T[]>();
  for (const item of items) {
    const key = groupKeyFor(item.status);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return ITEM_GROUPS.flatMap((group) => {
    const groupItems = buckets.get(group.key);
    return groupItems ? [{ ...group, items: groupItems }] : [];
  });
}

/** Title, price and description can change while the item is still the seller's. */
export function canEditItem(status: ItemStatus): boolean {
  return status === "listed" || status === "draft" || status === "hidden";
}

export function canDeleteItem(status: ItemStatus): boolean {
  return canEditItem(status);
}

export function canMarkCashSold(status: ItemStatus): boolean {
  return canEditItem(status);
}

/** A cash sale recorded by mistake can go back on sale. */
export function canRelist(status: ItemStatus): boolean {
  return status === "cash_sold";
}

/** Why an item cannot be changed, in plain words, or null when it can. */
export function lockedReason(status: ItemStatus): string | null {
  switch (status) {
    case "held":
      return "A buyer has this in their cart right now, so it cannot be changed. If they do not pay, it comes back in a few minutes.";
    case "sold":
      return "A buyer has paid for this, so it cannot be changed. Hand it over when they show their pickup code.";
    case "collected":
      return "This was paid for and picked up, so it cannot be changed.";
    case "cash_sold":
      return "You marked this as sold for cash. Put it back on sale if you need to change it.";
    default:
      return null;
  }
}
