import { describe, expect, it } from "vitest";

import { formatMoney, toDollars } from "./format-money";

describe("toDollars", () => {
  it("reads numbers and numeric strings as dollars", () => {
    expect(toDollars(12.5)).toBe(12.5);
    expect(toDollars("12.50")).toBe(12.5);
    expect(toDollars(" 7 ")).toBe(7);
  });

  it("rounds to cents", () => {
    expect(toDollars(0.1 + 0.2)).toBe(0.3);
    expect(toDollars(19.999)).toBe(20);
  });

  it("returns null for missing or invalid amounts", () => {
    expect(toDollars(null)).toBeNull();
    expect(toDollars(undefined)).toBeNull();
    expect(toDollars("")).toBeNull();
    expect(toDollars("abc")).toBeNull();
    expect(toDollars(Number.NaN)).toBeNull();
    expect(toDollars(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats dollars, not cents, with two decimals", () => {
    expect(formatMoney(5)).toBe("$5.00");
    expect(formatMoney(12.5)).toBe("$12.50");
    expect(formatMoney("1200")).toBe("$1,200.00");
    expect(formatMoney(99999999.99)).toBe("$99,999,999.99");
  });

  it("trims whole dollars only when asked", () => {
    expect(formatMoney(5, { trimWholeDollars: true })).toBe("$5");
    expect(formatMoney(5.25, { trimWholeDollars: true })).toBe("$5.25");
    expect(formatMoney("40.00", { trimWholeDollars: true })).toBe("$40");
  });

  it("uses the zero label for exactly zero", () => {
    expect(formatMoney(0, { zeroLabel: "Free" })).toBe("Free");
    expect(formatMoney("0.00", { zeroLabel: "Free" })).toBe("Free");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats refunds as negative amounts and never shows -$0.00", () => {
    expect(formatMoney(-4.5)).toBe("-$4.50");
    expect(formatMoney(-0.001)).toBe("$0.00");
  });

  it("shows an en dash when there is no amount", () => {
    expect(formatMoney(null)).toBe("–");
    expect(formatMoney("n/a")).toBe("–");
  });
});
