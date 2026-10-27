import { describe, expect, it } from "vitest";

import { canDonate, formatSaleDate, formatSaleTime, fundraiserLine, saleWhenLine } from "./sale-info";

describe("formatSaleDate", () => {
  it("formats a calendar date without shifting the day", () => {
    expect(formatSaleDate("2026-11-14")).toBe("Saturday, November 14");
  });

  it("returns null for missing or malformed dates", () => {
    expect(formatSaleDate(null)).toBeNull();
    expect(formatSaleDate("14/11/2026")).toBeNull();
  });
});

describe("formatSaleTime", () => {
  it("formats Postgres times", () => {
    expect(formatSaleTime("08:00:00")).toBe("8 am");
    expect(formatSaleTime("14:30")).toBe("2:30 pm");
    expect(formatSaleTime("12:00")).toBe("noon");
    expect(formatSaleTime("00:15")).toBe("12:15 am");
    expect(formatSaleTime("25:00")).toBeNull();
    expect(formatSaleTime(null)).toBeNull();
  });
});

describe("saleWhenLine", () => {
  it("joins the date and the hours", () => {
    expect(saleWhenLine("2026-11-14", "08:00:00", "14:00:00")).toBe("Saturday, November 14 · 8 am to 2 pm");
    expect(saleWhenLine("2026-11-14", "08:00", null)).toBe("Saturday, November 14 · from 8 am");
    expect(saleWhenLine("2026-11-14", null, null)).toBe("Saturday, November 14");
    expect(saleWhenLine(null, null, null)).toBeNull();
  });
});

describe("fundraiser", () => {
  it("mentions the gift only when donations can be paid", () => {
    expect(fundraiserLine("Maple PTA", true)).toBe("Raising money for Maple PTA. You can add a gift at checkout.");
    expect(fundraiserLine("Maple PTA", false)).toBe("Raising money for Maple PTA.");
    expect(fundraiserLine(null, true)).toBeNull();
  });

  it("shows the donation field only for a payable fundraiser", () => {
    expect(canDonate({ fundraiser_name: "Maple PTA", accepts_donations: true })).toBe(true);
    expect(canDonate({ fundraiser_name: "Maple PTA", accepts_donations: false })).toBe(false);
    expect(canDonate({ fundraiser_name: null, accepts_donations: true })).toBe(false);
  });
});
