import { describe, expect, it } from "vitest";

import {
  cartSubtotal,
  countdownLabel,
  donationCents,
  earliestExpiry,
  formatCountdown,
  grandTotal,
  groupByHousehold,
  liveLines,
  parseDonation,
  secondsLeft,
  type CartItemLine,
} from "./cart";

function line(overrides: Partial<CartItemLine>): CartItemLine {
  return {
    itemId: "i1",
    householdId: "h1",
    householdLabel: "The Alvarez table",
    title: "Bike",
    price: 25,
    holdExpiresAt: "2026-11-14T10:15:00Z",
    photoUrl: null,
    ...overrides,
  };
}

describe("groupByHousehold", () => {
  it("groups in first-seen order with cent-exact subtotals", () => {
    const groups = groupByHousehold([
      line({ itemId: "a", price: 0.1 }),
      line({ itemId: "b", householdId: "h2", householdLabel: "Oak corner", price: 4 }),
      line({ itemId: "c", price: 0.2 }),
    ]);
    expect(groups.map((group) => [group.label, group.lines.length, group.subtotal])).toEqual([
      ["The Alvarez table", 2, 0.3],
      ["Oak corner", 1, 4],
    ]);
  });

  it("returns nothing for an empty cart", () => {
    expect(groupByHousehold([])).toEqual([]);
  });
});

describe("cartSubtotal", () => {
  it("adds prices without float drift", () => {
    expect(cartSubtotal([{ price: 0.1 }, { price: 0.2 }, { price: 12 }])).toBe(12.3);
  });
});

describe("holds", () => {
  const now = Date.parse("2026-11-14T10:00:00Z");

  it("finds the earliest expiry", () => {
    expect(
      earliestExpiry([
        line({ holdExpiresAt: "2026-11-14T10:12:00Z" }),
        line({ holdExpiresAt: "2026-11-14T10:05:00Z" }),
        line({ holdExpiresAt: "not a date" }),
      ]),
    ).toBe("2026-11-14T10:05:00Z");
    expect(earliestExpiry([])).toBeNull();
  });

  it("drops expired lines", () => {
    const lines = [line({ itemId: "a", holdExpiresAt: "2026-11-14T09:59:59Z" }), line({ itemId: "b" })];
    expect(liveLines(lines, now).map((entry) => entry.itemId)).toEqual(["b"]);
  });

  it("counts seconds left, never below zero", () => {
    expect(secondsLeft("2026-11-14T10:12:34Z", now)).toBe(754);
    expect(secondsLeft("2026-11-14T10:00:00.400Z", now)).toBe(1);
    expect(secondsLeft("2026-11-14T09:00:00Z", now)).toBe(0);
    expect(secondsLeft("nope", now)).toBe(0);
  });

  it("formats the countdown", () => {
    expect(formatCountdown(754)).toBe("12:34");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(countdownLabel(754)).toBe("12 minutes 34 seconds");
    expect(countdownLabel(60)).toBe("1 minute");
    expect(countdownLabel(0)).toBe("0 seconds");
  });
});

describe("donations", () => {
  it("parses dollar amounts into cents", () => {
    expect(parseDonation("")).toEqual({ ok: true, cents: 0 });
    expect(parseDonation("7")).toEqual({ ok: true, cents: 700 });
    expect(parseDonation(" $7.5 ")).toEqual({ ok: true, cents: 750 });
    expect(parseDonation("1,000")).toEqual({ ok: true, cents: 100_000 });
    expect(parseDonation(".25")).toEqual({ ok: true, cents: 25 });
  });

  it("refuses bad, negative, over-precise or too large amounts", () => {
    expect(parseDonation("abc").ok).toBe(false);
    expect(parseDonation("-5").ok).toBe(false);
    expect(parseDonation("1.234").ok).toBe(false);
    expect(parseDonation("1000.01").ok).toBe(false);
  });

  it("uses presets or the custom field", () => {
    expect(donationCents(10, "99")).toEqual({ ok: true, cents: 1000 });
    expect(donationCents("custom", "3.25")).toEqual({ ok: true, cents: 325 });
  });

  it("adds the donation to the grand total", () => {
    expect(grandTotal(30.1, 500)).toBe(35.1);
    expect(grandTotal(0.1, 20)).toBe(0.3);
  });
});
