import type { PostgrestSingleResponse, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ITEM_STATUSES,
  maxHouseholdsPerCart,
  SELLER_SETTABLE_ITEM_STATUSES,
  TABLE_COLUMNS,
  type Database,
  type HouseholdRow,
  type OrganizerSaleSummary,
  type PickupRow,
  type PublicListingRow,
} from "./types";

// Compile-time checks: `tsc --noEmit` fails if the Database type stops lining up with
// supabase-js. The function body never runs.
function typeChecks(db: SupabaseClient<Database>) {
  expectTypeOf(db.from("public_listings").select("*")).resolves.toEqualTypeOf<
    PostgrestSingleResponse<PublicListingRow[]>
  >();
  expectTypeOf(db.from("households").select("*").eq("sale_id", "s").single()).resolves.toEqualTypeOf<
    PostgrestSingleResponse<HouseholdRow>
  >();
  expectTypeOf(db.rpc("get_my_pickups")).resolves.toEqualTypeOf<PostgrestSingleResponse<PickupRow[]>>();
  expectTypeOf(db.rpc("organizer_sale_summary", { p_sale: "s" })).resolves.toEqualTypeOf<
    PostgrestSingleResponse<OrganizerSaleSummary>
  >();
  expectTypeOf(db.rpc("hold_item", { p_item: "i", p_cart: "c" })).resolves.toEqualTypeOf<
    PostgrestSingleResponse<boolean>
  >();

  // @ts-expect-error unknown table
  void db.from("not_a_table");
  // @ts-expect-error hold_item needs p_cart
  void db.rpc("hold_item", { p_item: "i" });
  // @ts-expect-error invalid item status
  void db.from("items").update({ status: "stolen" });
}

describe("types", () => {
  it("compiles the client type checks", () => {
    expect(typeof typeChecks).toBe("function");
  });

  it("keeps the seller-settable statuses a subset of item statuses", () => {
    for (const status of SELLER_SETTABLE_ITEM_STATUSES) {
      expect(ITEM_STATUSES).toContain(status);
    }
  });

  it("reserves one PayPal purchase unit for the donation when there is a fundraiser", () => {
    expect(maxHouseholdsPerCart(null)).toBe(10);
    expect(maxHouseholdsPerCart("Maple Street Elementary PTA")).toBe(9);
  });

  it("lists columns for every table", () => {
    expect(Object.keys(TABLE_COLUMNS).sort()).toEqual([
      "cart_lines",
      "carts",
      "households",
      "items",
      "paypal_events",
      "purchase_units",
      "sales",
    ]);
  });
});
