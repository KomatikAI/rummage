import { describe, expect, it } from "vitest";

import type { ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";

import { orderRows, orderTotals, parseRefundInput, refundErrorMessage, refundSuccessMessage } from "./orders";

const summary: ParsedOrganizerSummary = {
  sale_id: "s1",
  households: 2,
  households_linked: 2,
  items_listed: 3,
  items_held: 0,
  items_sold: 3,
  items_collected: 2,
  items_cash_sold: 1,
  gross_total: 30.106,
  cash_total: 4,
  fundraiser_total: 6.5,
  fundraiser_goal: null,
  paid_order_count: 2,
  per_household: [
    {
      household_id: "h1",
      label: "Oak corner",
      paypal_status: "ready",
      paused: false,
      items_listed: 1,
      items_held: 0,
      items_sold: 3,
      items_collected: 2,
      items_cash_sold: 1,
      cash_total: 4,
      gross: 30.106,
    },
    {
      household_id: "h2",
      label: "Two Sisters Swap",
      paypal_status: "ready",
      paused: false,
      items_listed: 2,
      items_held: 0,
      items_sold: 0,
      items_collected: 0,
      items_cash_sold: 0,
      cash_total: 0,
      gross: 0,
    },
  ],
};

describe("orderRows and orderTotals", () => {
  it("lists each household's payments from the summary", () => {
    expect(orderRows(summary)).toEqual([
      { householdId: "h1", label: "Oak corner", paidOnline: 30.11, cash: 4, itemsSold: 4, itemsCollected: 2, captureState: "captured" },
      { householdId: "h2", label: "Two Sisters Swap", paidOnline: 0, cash: 0, itemsSold: 0, itemsCollected: 0, captureState: "none" },
    ]);
  });

  it("totals the sale", () => {
    expect(orderTotals(summary)).toEqual({ paidOnline: 30.11, cash: 4, donations: 6.5, paidOrders: 2 });
  });
});

describe("parseRefundInput", () => {
  it("accepts a transaction id and an optional note", () => {
    expect(parseRefundInput(" 2GG279541U471931P ", "")).toEqual({ ok: true, body: { captureId: "2GG279541U471931P" } });
    expect(parseRefundInput("ABC-1", " Item was broken ")).toEqual({
      ok: true,
      body: { captureId: "ABC-1", reason: "Item was broken" },
    });
  });

  it("explains a missing or malformed id and a long note", () => {
    expect(parseRefundInput("", "")).toMatchObject({ ok: false, field: "captureId" });
    expect(parseRefundInput("not an id!", "")).toMatchObject({ ok: false, field: "captureId" });
    expect(parseRefundInput("x".repeat(37), "")).toMatchObject({ ok: false, field: "captureId" });
    expect(parseRefundInput("ABC", "y".repeat(256))).toMatchObject({ ok: false, field: "reason" });
  });
});

describe("refund messages", () => {
  it("maps route errors to plain sentences", () => {
    expect(refundErrorMessage("already_refunded")).toBe("That payment has already been refunded.");
    expect(refundErrorMessage("forbidden")).toContain("not from this sale");
    expect(refundErrorMessage("something_new")).toContain("did not go through");
    expect(refundErrorMessage(undefined)).toContain("did not go through");
  });

  it("tells a completed refund from a pending one", () => {
    expect(refundSuccessMessage("COMPLETED")).toContain("Refunded in full");
    expect(refundSuccessMessage("pending")).toContain("still processing");
  });
});
