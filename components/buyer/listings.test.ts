import { describe, expect, it } from "vitest";

import type { PublicListingRow } from "@/lib/supabase/types";

import {
  categoriesPresent,
  filterListings,
  householdPins,
  itemCountLabel,
  matchesQuery,
  photoUrl,
  toSaleItem,
  type SaleItem,
} from "./listings";

function item(overrides: Partial<SaleItem>): SaleItem {
  return {
    id: "i1",
    title: "Kids balance bike",
    description: "Lightweight bike",
    category: "kids",
    condition: "good",
    price: 25,
    status: "available",
    acceptsPayments: true,
    householdId: "h1",
    householdLabel: "The Alvarez table",
    lng: -90.288,
    lat: 38.637,
    photoUrl: null,
    ...overrides,
  };
}

describe("photoUrl", () => {
  it("builds a public bucket URL and encodes each segment", () => {
    expect(photoUrl("https://x.supabase.co/", "seed/kids bike.jpg")).toBe(
      "https://x.supabase.co/storage/v1/object/public/item-photos/seed/kids%20bike.jpg",
    );
  });

  it("returns null without a path", () => {
    expect(photoUrl("https://x.supabase.co", null)).toBeNull();
    expect(photoUrl("https://x.supabase.co", "")).toBeNull();
  });
});

describe("toSaleItem", () => {
  it("maps a public listing row, including numeric strings", () => {
    const row = {
      item_id: "i9",
      sale_id: "s1",
      sale_slug: "maple",
      household_id: "h2",
      household_label: "Oak corner",
      public_lng: "-90.28" as unknown as number,
      public_lat: 38.63,
      accepts_paypal: true,
      title: "Lamp",
      description: null,
      category: "decor",
      condition: "good",
      price: "12.50" as unknown as number,
      price_low: null,
      price_high: null,
      price_reason: null,
      photo_path: "seed/lamp.jpg",
      status: "held",
      created_at: "2026-10-01T00:00:00Z",
    } satisfies PublicListingRow;
    const mapped = toSaleItem(row, "https://x.supabase.co");
    expect(mapped).toMatchObject({
      id: "i9",
      price: 12.5,
      lng: -90.28,
      status: "held",
      acceptsPayments: true,
      condition: "good",
      householdLabel: "Oak corner",
      photoUrl: "https://x.supabase.co/storage/v1/object/public/item-photos/seed/lamp.jpg",
    });
  });
});

describe("matchesQuery", () => {
  it("matches every word across title, description, category and household", () => {
    expect(matchesQuery(item({}), "bike alvarez")).toBe(true);
    expect(matchesQuery(item({}), "KIDS")).toBe(true);
    expect(matchesQuery(item({}), "bike sofa")).toBe(false);
    expect(matchesQuery(item({}), "   ")).toBe(true);
  });

  it("ignores accents", () => {
    expect(matchesQuery(item({ title: "Café table" }), "cafe")).toBe(true);
  });
});

describe("filterListings", () => {
  const items = [
    item({ id: "a", status: "sold" }),
    item({ id: "b", category: "books", title: "Picture books", householdId: "h2" }),
    item({ id: "c", status: "held" }),
    item({ id: "d" }),
  ];

  it("puts sold items last and keeps the rest in order", () => {
    expect(filterListings(items, {}).map((entry) => entry.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("filters by category, household and query together", () => {
    expect(filterListings(items, { category: "books" }).map((entry) => entry.id)).toEqual(["b"]);
    expect(filterListings(items, { householdId: "h1" }).map((entry) => entry.id)).toEqual(["d", "c", "a"]);
    expect(filterListings(items, { query: "picture", householdId: "h1" })).toEqual([]);
  });
});

describe("categoriesPresent", () => {
  it("lists used categories in schema order", () => {
    expect(categoriesPresent([item({ category: "tools" }), item({ category: "kids" }), item({ category: "tools" })])).toEqual([
      "kids",
      "tools",
    ]);
  });
});

describe("householdPins", () => {
  it("makes one pin per household and counts items still for sale", () => {
    const pins = householdPins([
      item({ id: "a" }),
      item({ id: "b", status: "sold" }),
      item({ id: "c", status: "held" }),
      item({ id: "d", householdId: "h2", householdLabel: "Oak corner", lng: -90.28, lat: 38.64 }),
      item({ id: "e", householdId: "h3", lng: null, lat: null }),
    ]);
    expect(pins).toEqual([
      { householdId: "h1", label: "The Alvarez table", lng: -90.288, lat: 38.637, count: 2 },
      { householdId: "h2", label: "Oak corner", lng: -90.28, lat: 38.64, count: 1 },
    ]);
  });
});

describe("itemCountLabel", () => {
  it("pluralises", () => {
    expect(itemCountLabel(1)).toBe("1 item");
    expect(itemCountLabel(0)).toBe("0 items");
  });
});
