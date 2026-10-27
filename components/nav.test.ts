import { describe, expect, it } from "vitest";

import { activeNavHref } from "./nav";

describe("activeNavHref", () => {
  it("matches each section and its sub-pages", () => {
    expect(activeNavHref("/sale/demo")).toBe("/sale/demo");
    expect(activeNavHref("/sale/maple-street/items/3")).toBe("/sale/demo");
    expect(activeNavHref("/buyer/cart")).toBe("/buyer/cart");
    expect(activeNavHref("/buyer/pickups")).toBe("/buyer/cart");
    expect(activeNavHref("/seller")).toBe("/seller");
    expect(activeNavHref("/seller/items/new")).toBe("/seller");
    expect(activeNavHref("/organizer")).toBe("/organizer");
  });

  it("does not match look-alike prefixes or other pages", () => {
    expect(activeNavHref("/sellers")).toBeNull();
    expect(activeNavHref("/saleroom")).toBeNull();
    expect(activeNavHref("/")).toBeNull();
    expect(activeNavHref("/sign-in")).toBeNull();
    expect(activeNavHref(null)).toBeNull();
  });
});
