import { describe, expect, it } from "vitest";

import type { PickupRow } from "@/lib/supabase/types";

import { buildReceipt, orderOutcome, OUTCOME_COPY, unitPayment } from "./orders";

function pickup(overrides: Partial<PickupRow>): PickupRow {
  return {
    purchase_unit_id: "u1",
    cart_id: "c1",
    sale_id: "s1",
    sale_name: "Maple",
    household_id: "h1",
    household_label: "The Alvarez table",
    item_id: "i1",
    item_title: "Bike",
    item_status: "sold",
    exact_lng: -90.289,
    exact_lat: 38.6376,
    pickup_code: "4821",
    capture_status: "COMPLETED",
    ...overrides,
  };
}

describe("unitPayment", () => {
  it("maps capture statuses", () => {
    expect(unitPayment("COMPLETED")).toBe("paid");
    expect(unitPayment("completed")).toBe("paid");
    expect(unitPayment("PENDING")).toBe("checking");
    expect(unitPayment("DECLINED")).toBe("not_paid");
    expect(unitPayment(null)).toBe("not_paid");
  });
});

describe("orderOutcome", () => {
  it("follows the settled cart status", () => {
    expect(orderOutcome("paid", [{ captureStatus: "COMPLETED" }])).toBe("all_paid");
    expect(orderOutcome("partial", [{ captureStatus: "COMPLETED" }, { captureStatus: "DECLINED" }])).toBe("partial");
    expect(orderOutcome("failed", [{ captureStatus: "DECLINED" }])).toBe("none");
    expect(orderOutcome("checkout", [{ captureStatus: null }])).toBe("checking");
  });

  it("says still checking while any capture is pending", () => {
    expect(orderOutcome("partial", [{ captureStatus: "PENDING" }, { captureStatus: "COMPLETED" }])).toBe("checking");
  });

  it("treats an open cart with no units as nothing paid", () => {
    expect(orderOutcome("open", [])).toBe("none");
  });

  it("has copy for every outcome without exclamation marks", () => {
    for (const copy of Object.values(OUTCOME_COPY)) expect(`${copy.title}${copy.body}`).not.toContain("!");
  });
});

describe("buildReceipt", () => {
  it("builds one card per unit with lines, code and exact pin", () => {
    const { households, donation } = buildReceipt({
      units: [
        { householdId: "h1", amount: 37, captureStatus: "COMPLETED" },
        { householdId: "h2", amount: 8, captureStatus: "DECLINED" },
        { householdId: null, amount: 5, captureStatus: "COMPLETED" },
      ],
      lines: [
        { itemId: "i1", householdId: "h1", householdLabel: "The Alvarez table", title: "Bike", price: 25 },
        { itemId: "i2", householdId: "h1", householdLabel: "The Alvarez table", title: "Bowls", price: 12 },
        { itemId: "i3", householdId: "h2", householdLabel: "Oak corner", title: "Lamp", price: 8 },
        { itemId: "i4", householdId: "h9", householdLabel: "Gone", title: "Released", price: 3 },
      ],
      pickups: [pickup({ item_id: "i1" }), pickup({ item_id: "i2", item_title: "Bowls" })],
    });
    expect(donation).toEqual({ amount: 5, payment: "paid" });
    expect(households).toHaveLength(2);
    expect(households[0]).toMatchObject({
      label: "The Alvarez table",
      amount: 37,
      payment: "paid",
      pickupCode: "4821",
      lng: -90.289,
      lat: 38.6376,
    });
    expect(households[0].items.map((entry) => entry.title)).toEqual(["Bike", "Bowls"]);
    expect(households[1]).toMatchObject({ label: "Oak corner", payment: "not_paid", pickupCode: null, lng: null });
  });

  it("falls back to lines when checkout never created units", () => {
    const { households, donation } = buildReceipt({
      units: [],
      lines: [
        { itemId: "i1", householdId: "h1", householdLabel: "The Alvarez table", title: "Bike", price: 25 },
        { itemId: "i2", householdId: "h1", householdLabel: "The Alvarez table", title: "Bowls", price: 12.5 },
      ],
      pickups: [],
    });
    expect(donation).toBeNull();
    expect(households).toEqual([
      expect.objectContaining({ householdId: "h1", amount: 37.5, payment: "not_paid", items: expect.any(Array) }),
    ]);
  });

  it("adds paid items that only the pickups know about", () => {
    const { households } = buildReceipt({
      units: [{ householdId: "h1", amount: 25, captureStatus: "COMPLETED" }],
      lines: [],
      pickups: [pickup({ item_id: "i7", item_title: "Rake" })],
    });
    expect(households[0]).toMatchObject({ label: "The Alvarez table", items: [{ itemId: "i7", title: "Rake", price: null }] });
  });
});
