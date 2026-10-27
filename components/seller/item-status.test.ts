import { describe, expect, it } from "vitest";

import { ITEM_STATUSES, type ItemStatus } from "@/lib/supabase/types";

import {
  canDeleteItem,
  canEditItem,
  canMarkCashSold,
  canRelist,
  groupItemsByStatus,
  groupKeyFor,
  ITEM_GROUPS,
  lockedReason,
} from "./item-status";

const item = (id: string, status: ItemStatus) => ({ id, status });

describe("groupItemsByStatus", () => {
  it("puts paid items first and drops empty groups", () => {
    const groups = groupItemsByStatus([item("a", "listed"), item("b", "sold"), item("c", "listed")]);
    expect(groups.map((group) => group.key)).toEqual(["sold", "listed"]);
    expect(groups[1].items.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("folds draft and hidden into Not listed", () => {
    const groups = groupItemsByStatus([item("a", "draft"), item("b", "hidden")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("unlisted");
    expect(groups[0].items).toHaveLength(2);
  });

  it("returns nothing for no items", () => {
    expect(groupItemsByStatus([])).toEqual([]);
  });

  it("has a group for every status", () => {
    const keys = new Set(ITEM_GROUPS.map((group) => group.key));
    for (const status of ITEM_STATUSES) expect(keys.has(groupKeyFor(status))).toBe(true);
  });
});

describe("what a seller may do", () => {
  it("edits, deletes and records cash sales only while the item is theirs", () => {
    for (const status of ["listed", "draft", "hidden"] as const) {
      expect(canEditItem(status)).toBe(true);
      expect(canDeleteItem(status)).toBe(true);
      expect(canMarkCashSold(status)).toBe(true);
      expect(lockedReason(status)).toBeNull();
    }
  });

  it("locks items in the buyer flow and explains why", () => {
    for (const status of ["held", "sold", "collected"] as const) {
      expect(canEditItem(status)).toBe(false);
      expect(canDeleteItem(status)).toBe(false);
      expect(canMarkCashSold(status)).toBe(false);
      expect(lockedReason(status)).toMatch(/cannot be changed/);
    }
  });

  it("lets a cash sale go back on sale", () => {
    expect(canRelist("cash_sold")).toBe(true);
    expect(canRelist("listed")).toBe(false);
    expect(canEditItem("cash_sold")).toBe(false);
    expect(lockedReason("cash_sold")).toMatch(/Put it back on sale/);
  });
});
