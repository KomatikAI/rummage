import { describe, expect, it } from "vitest";

import { assistantErrorMessage, summariseToolPart, toolNameOf } from "./assistant-parts";

describe("toolNameOf", () => {
  it("strips the tool- prefix", () => {
    expect(toolNameOf("tool-hold_item")).toBe("hold_item");
    expect(toolNameOf("text")).toBeNull();
  });
});

describe("summariseToolPart", () => {
  it("shows a working line before the output arrives", () => {
    expect(summariseToolPart("search_items", "input-available", undefined)).toEqual({
      text: "Looking through the tables…",
      tone: "info",
      cartLink: false,
    });
  });

  it("lists found items", () => {
    const summary = summariseToolPart("search_items", "output-available", {
      items: [{ id: "i1", title: "Bike", price: 25, status: "available", householdName: "Oak corner" }, { nope: 1 }],
    });
    expect(summary.text).toBe("Found 1 item.");
    expect(summary.items).toEqual([{ id: "i1", title: "Bike", price: 25, status: "available", householdName: "Oak corner" }]);
  });

  it("links to the cart after a hold", () => {
    expect(summariseToolPart("hold_item", "output-available", { ok: true, itemId: "i1" })).toMatchObject({
      tone: "success",
      cartLink: true,
    });
    expect(summariseToolPart("hold_item", "output-available", { ok: false, reason: "already_held" })).toMatchObject({
      text: "Someone else is holding that one right now.",
      cartLink: false,
    });
  });

  it("summarises the cart and release", () => {
    expect(summariseToolPart("get_cart", "output-available", { lines: [{}, {}] }).text).toBe("2 items in your cart.");
    expect(summariseToolPart("get_cart", "output-available", { lines: [] }).cartLink).toBe(false);
    expect(summariseToolPart("release_hold", "output-available", { ok: true }).text).toBe("Taken out of your cart.");
  });

  it("says when a step failed", () => {
    expect(summariseToolPart("hold_item", "output-error", undefined).tone).toBe("warning");
  });
});

describe("assistantErrorMessage", () => {
  it("maps route errors to sentences", () => {
    expect(assistantErrorMessage('{"error":"sign_in_required"}')).toMatch(/Sign in/);
    expect(assistantErrorMessage('{"error":"cart_in_checkout"}')).toMatch(/checkout/);
    expect(assistantErrorMessage(undefined)).toMatch(/Try again/);
  });
});
