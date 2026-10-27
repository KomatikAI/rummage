import { describe, expect, it } from "vitest";

import type { ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";

import {
  formatSaleWhen,
  formatTimeOfDay,
  householdLinkState,
  householdRows,
  householdsReadyLine,
  inviteLink,
  inviteReminder,
  linkPayPalLabel,
  linkStateLook,
  onboardingNotice,
  paidOrdersLine,
  readOnboardingParam,
  saleStatusLook,
  statusActions,
  summaryStats,
} from "./dashboard";

const summary: ParsedOrganizerSummary = {
  sale_id: "a0000000-0000-4000-8000-000000000001",
  households: 2,
  households_linked: 1,
  items_listed: 7,
  items_held: 2,
  items_sold: 4,
  items_collected: 1,
  items_cash_sold: 1,
  gross_total: 41.1,
  cash_total: 5.2,
  fundraiser_total: 12,
  fundraiser_goal: 500,
  paid_order_count: 3,
  per_household: [
    {
      household_id: "h1",
      label: "The Alvarez table",
      paypal_status: "ready",
      paused: false,
      items_listed: 4,
      items_held: 1,
      items_sold: 3,
      items_collected: 1,
      items_cash_sold: 1,
      cash_total: 5.2,
      gross: 41.1,
    },
    {
      household_id: "h2",
      label: "Garage Gnomes",
      paypal_status: "revoked",
      paused: true,
      items_listed: 3,
      items_held: 1,
      items_sold: 1,
      items_collected: 0,
      items_cash_sold: 0,
      cash_total: 0,
      gross: 0,
    },
  ],
};

describe("sale status", () => {
  it("labels every status with a word", () => {
    expect(saleStatusLook("draft")).toEqual({ tone: "outline", label: "Draft" });
    expect(saleStatusLook("open").label).toBe("Open");
    expect(saleStatusLook("closed").label).toBe("Closed");
  });

  it("offers open for drafts and closed sales, close for open ones", () => {
    expect(statusActions("draft")).toEqual([{ to: "open", label: "Open sale", variant: "primary" }]);
    expect(statusActions("open").map((action) => action.to)).toEqual(["closed"]);
    expect(statusActions("closed").map((action) => action.label)).toEqual(["Open sale"]);
  });
});

describe("dates", () => {
  it("formats times of day", () => {
    expect(formatTimeOfDay("08:00:00")).toBe("8:00 AM");
    expect(formatTimeOfDay("00:15")).toBe("12:15 AM");
    expect(formatTimeOfDay("12:00")).toBe("12:00 PM");
    expect(formatTimeOfDay("14:30")).toBe("2:30 PM");
    expect(formatTimeOfDay("soon")).toBe("soon");
  });

  it("formats the sale day and hours without shifting the date", () => {
    expect(formatSaleWhen("2026-11-14", "08:00:00", "14:00:00")).toBe("Saturday, November 14, 2026 · 8:00 AM to 2:00 PM");
    expect(formatSaleWhen("2026-11-14", "08:00", null)).toBe("Saturday, November 14, 2026 · from 8:00 AM");
    expect(formatSaleWhen(null, "08:00", "14:00")).toBe("Date not set");
  });
});

describe("summaryStats", () => {
  it("mirrors the sale summary maths", () => {
    const stats = summaryStats(summary);
    expect(stats.map((stat) => [stat.key, stat.value])).toEqual([
      ["available", 7],
      ["held", 2],
      ["sold", 5],
      ["collected", 1],
      ["gross", 46.3],
    ]);
    expect(stats.find((stat) => stat.key === "gross")?.money).toBe(true);
  });
});

describe("households", () => {
  it("maps PayPal status to three link states", () => {
    expect(householdLinkState("ready")).toBe("ready");
    expect(householdLinkState("pending")).toBe("pending");
    expect(householdLinkState("unlinked")).toBe("unlinked");
    expect(householdLinkState("revoked")).toBe("unlinked");
    expect(linkStateLook("unlinked").label).toBe("Not linked");
    expect(linkStateLook("ready").tone).toBe("ready");
  });

  it("builds table rows with listed and sold counts", () => {
    expect(householdRows(summary)).toEqual([
      { id: "h1", label: "The Alvarez table", linkState: "ready", paused: false, itemsListed: 9, itemsSold: 4 },
      { id: "h2", label: "Garage Gnomes", linkState: "unlinked", paused: true, itemsListed: 5, itemsSold: 1 },
    ]);
  });

  it("says how many households can be paid", () => {
    expect(householdsReadyLine(summary)).toBe("1 of 2 households can be paid at checkout.");
    expect(householdsReadyLine({ households: 1, households_linked: 1 })).toBe("1 of 1 household can be paid at checkout.");
    expect(householdsReadyLine({ households: 0, households_linked: 0 })).toContain("Share the invite link");
  });
});

describe("invites", () => {
  it("builds the join link from APP_URL", () => {
    expect(inviteLink("https://rummage.test/", "abc 123")).toBe("https://rummage.test/seller?invite=abc%20123");
  });

  it("writes a reminder that fits the household's state", () => {
    const base = { label: "Oak corner", saleName: "Spring Rummage", link: "https://r.test/seller?invite=t" };
    expect(inviteReminder({ ...base, linkState: "unlinked" })).toContain("link your PayPal");
    expect(inviteReminder({ ...base, linkState: "pending" })).toContain("still checking");
    const ready = inviteReminder({ ...base, linkState: "ready" });
    expect(ready).toContain("all set");
    expect(ready.endsWith(base.link)).toBe(true);
    for (const state of ["unlinked", "pending", "ready"] as const) {
      expect(inviteReminder({ ...base, linkState: state })).not.toContain("!");
    }
  });
});

describe("fundraiser", () => {
  it("names the PTA when the fundraiser is one", () => {
    expect(linkPayPalLabel("Maple Street Elementary PTA")).toBe("Link the PTA's PayPal");
    expect(linkPayPalLabel("Library roof fund")).toBe("Link the fundraiser's PayPal");
  });

  it("reads only known onboarding values", () => {
    expect(readOnboardingParam("ready")).toBe("ready");
    expect(readOnboardingParam(["pending", "ready"])).toBe("pending");
    expect(readOnboardingParam("done")).toBeNull();
    expect(readOnboardingParam(undefined)).toBeNull();
  });

  it("writes the notice after the PayPal return", () => {
    expect(onboardingNotice("ready", "Maple Street Elementary PTA")).toContain("PayPal is linked for Maple Street Elementary PTA");
    expect(onboardingNotice("pending", null)).toContain("the fundraiser");
  });

  it("counts paid orders in words", () => {
    expect(paidOrdersLine(0)).toBe("No paid orders yet");
    expect(paidOrdersLine(1)).toBe("1 paid order");
    expect(paidOrdersLine(3)).toBe("3 paid orders");
  });
});
