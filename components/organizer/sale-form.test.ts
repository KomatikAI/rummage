import { describe, expect, it } from "vitest";

import { EMPTY_SALE_FORM, parseSaleForm, readSaleForm, toSaleInsert, type SaleFormValues } from "./sale-form";

const good: SaleFormValues = {
  ...EMPTY_SALE_FORM,
  name: "Maple Street Elementary PTA Spring Rummage",
  saleDate: "2026-11-14",
  startsAt: "08:00",
  endsAt: "14:00",
  description: "Six family tables in the park.",
  fundraiserName: "Maple Street Elementary PTA",
  fundraiserGoal: "500",
};

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("readSaleForm", () => {
  it("trims values and fills missing fields with empty strings", () => {
    const values = readSaleForm(form({ name: "  Spring sale  " }));
    expect(values.name).toBe("Spring sale");
    expect(values.fundraiserName).toBe("");
    expect(values.areaLat).toBe("");
  });
});

describe("parseSaleForm", () => {
  it("accepts the example sale and converts numbers", () => {
    const parsed = parseSaleForm(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.areaLat).toBe(38.6382);
    expect(parsed.data.areaLng).toBe(-90.2847);
    expect(parsed.data.areaRadiusM).toBe(1200);
    expect(parsed.data.fundraiserGoal).toBe(500);
  });

  it("names every missing required field", () => {
    const parsed = parseSaleForm({ ...good, name: "", saleDate: "", startsAt: "", areaLat: "" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["areaLat", "name", "saleDate", "startsAt"]);
    expect(parsed.fieldErrors.name).toBe("Give the sale a name.");
  });

  it("rejects impossible dates, reversed hours and out-of-range areas", () => {
    const parsed = parseSaleForm({ ...good, saleDate: "2026-02-30", endsAt: "07:00", areaRadiusM: "20", areaLng: "200" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fieldErrors.saleDate).toBeDefined();
    expect(parsed.fieldErrors.endsAt).toBe("The sale needs to end after it starts.");
    expect(parsed.fieldErrors.areaRadiusM).toBeDefined();
    expect(parsed.fieldErrors.areaLng).toBeDefined();
    expect(parseSaleForm({ ...good, areaRadiusM: "100.5" }).ok).toBe(false);
  });

  it("checks the goal and needs a fundraiser name for it", () => {
    const zero = parseSaleForm({ ...good, fundraiserGoal: "0" });
    expect(zero.ok ? null : zero.fieldErrors.fundraiserGoal).toBe("The goal needs to be more than $0.");
    const words = parseSaleForm({ ...good, fundraiserGoal: "lots" });
    expect(words.ok ? null : words.fieldErrors.fundraiserGoal).toBeDefined();
    const noName = parseSaleForm({ ...good, fundraiserName: "" });
    expect(noName.ok ? null : noName.fieldErrors.fundraiserName).toBe("Name the fundraiser to set a goal.");
    const dollars = parseSaleForm({ ...good, fundraiserGoal: "$1,250.50" });
    expect(dollars.ok ? dollars.data.fundraiserGoal : null).toBe(1250.5);
    expect(parseSaleForm({ ...good, fundraiserName: "", fundraiserGoal: "" }).ok).toBe(true);
  });

  it("caps the description", () => {
    const parsed = parseSaleForm({ ...good, description: "x".repeat(601) });
    expect(parsed.ok ? null : parsed.fieldErrors.description).toBeDefined();
  });
});

describe("toSaleInsert", () => {
  it("builds an insert row without status or invite token", () => {
    const parsed = parseSaleForm({ ...good, startsAt: "08:00:00" });
    if (!parsed.ok) throw new Error("expected valid");
    const row = toSaleInsert(parsed.data, "user-1", "maple-street");
    expect(row).toEqual({
      organizer_user_id: "user-1",
      name: good.name,
      slug: "maple-street",
      description: "Six family tables in the park.",
      sale_date: "2026-11-14",
      starts_at: "08:00",
      ends_at: "14:00",
      area_lat: 38.6382,
      area_lng: -90.2847,
      area_radius_m: 1200,
      fundraiser_name: "Maple Street Elementary PTA",
      fundraiser_goal: 500,
    });
    expect(row).not.toHaveProperty("status");
    expect(row).not.toHaveProperty("invite_token");
  });

  it("stores nulls for an empty description and no fundraiser", () => {
    const parsed = parseSaleForm({ ...good, description: "", fundraiserName: "", fundraiserGoal: "" });
    if (!parsed.ok) throw new Error("expected valid");
    const row = toSaleInsert(parsed.data, "user-1", "s");
    expect(row.description).toBeNull();
    expect(row.fundraiser_name).toBeNull();
    expect(row.fundraiser_goal).toBeNull();
  });
});
