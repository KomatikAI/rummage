import { describe, expect, it } from "vitest";

import { HOLD_ITEM_RESULTS, maxHouseholdsPerCart, RELEASE_HOLD_RESULTS } from "@/lib/supabase/types";

import { holdResultMessage, releaseResultMessage, signInHref } from "./hold-messages";

describe("holdResultMessage", () => {
  it("has a plain sentence for every hold_item result", () => {
    for (const result of HOLD_ITEM_RESULTS) {
      const message = holdResultMessage(result, { maxHouseholds: 9 });
      expect(message.message.length).toBeGreaterThan(10);
      expect(message.message).not.toMatch(/!|human/i);
      expect(message.ok).toBe(result === "held");
    }
  });

  it("names the household cap", () => {
    expect(holdResultMessage("cap_reached", { maxHouseholds: maxHouseholdsPerCart("Maple PTA") }).message).toContain(
      "You can shop up to 9 tables in one order",
    );
    expect(holdResultMessage("cap_reached", { maxHouseholds: 1 }).message).toContain("up to 1 table in");
  });

  it("explains the seller, already-held and own-item cases", () => {
    expect(holdResultMessage("seller_not_ready", { maxHouseholds: 10 }).message).toMatch(/not set up/);
    expect(holdResultMessage("already_held", { maxHouseholds: 10 }).message).toMatch(/Someone else/);
    expect(holdResultMessage("own_item", { maxHouseholds: 10 }).message).toMatch(/your own/);
  });
});

describe("releaseResultMessage", () => {
  it("has a sentence for every release_hold result", () => {
    for (const result of RELEASE_HOLD_RESULTS) {
      const message = releaseResultMessage(result);
      expect(message.message.length).toBeGreaterThan(10);
      expect(message.message).not.toContain("!");
    }
    expect(releaseResultMessage("released").ok).toBe(true);
    expect(releaseResultMessage("cart_not_open").ok).toBe(false);
  });
});

describe("signInHref", () => {
  it("encodes the return path", () => {
    expect(signInHref("/sale/maple-street")).toBe("/sign-in?next=%2Fsale%2Fmaple-street");
  });
});
