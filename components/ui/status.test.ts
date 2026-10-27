import { describe, expect, it } from "vitest";

import {
  BADGE_STATUSES,
  itemStatusBadge,
  paypalStatusBadge,
  statusLabel,
  statusTone,
  type BadgeStatus,
  type ItemStatus,
} from "./status";

describe("statusTone", () => {
  it("maps every status to the documented tone", () => {
    expect(BADGE_STATUSES.map((status) => [status, statusTone(status)])).toEqual([
      ["available", "accent"],
      ["held", "held"],
      ["sold", "neutral"],
      ["collected", "ready-soft"],
      ["ready", "ready"],
      ["pending", "outline"],
    ]);
  });

  it("gives every status a plain one-word label", () => {
    for (const status of BADGE_STATUSES) {
      expect(statusLabel(status)).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe("itemStatusBadge", () => {
  it("maps every items.status value", () => {
    const cases: Array<[ItemStatus, BadgeStatus]> = [
      ["listed", "available"],
      ["held", "held"],
      ["sold", "sold"],
      ["cash_sold", "sold"],
      ["collected", "collected"],
      ["draft", "pending"],
      ["hidden", "pending"],
    ];
    for (const [input, expected] of cases) {
      expect(itemStatusBadge(input)).toBe(expected);
    }
  });
});

describe("paypalStatusBadge", () => {
  it("is ready only when PayPal says so", () => {
    expect(paypalStatusBadge("ready")).toBe("ready");
    expect(paypalStatusBadge("pending")).toBe("pending");
    expect(paypalStatusBadge("unlinked")).toBe("pending");
    expect(paypalStatusBadge("revoked")).toBe("pending");
  });
});
