import { describe, expect, it } from "vitest";

import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugify, slugWithSuffix } from "./slug";

describe("slugify", () => {
  it("turns a sale name into lower-case hyphenated words", () => {
    expect(slugify("Maple Street Elementary PTA Spring Rummage")).toBe("maple-street-elementary-pta-spring-rummage");
    expect(slugify("  Maple St. PTA: Spring Rummage!  ")).toBe("maple-st-pta-spring-rummage");
  });

  it("folds accents and spells out ampersands", () => {
    expect(slugify("Café & Crêpes Swap")).toBe("cafe-and-crepes-swap");
  });

  it("falls back when nothing usable is left", () => {
    expect(slugify("!!!")).toBe("sale");
    expect(slugify("")).toBe("sale");
  });

  it("stays within 80 characters and never ends on a hyphen", () => {
    const slug = slugify(`${"a".repeat(79)} b c d`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toMatch(SLUG_PATTERN);
    expect(slugify("word ".repeat(40))).toMatch(SLUG_PATTERN);
  });
});

describe("slugWithSuffix", () => {
  it("appends a cleaned suffix", () => {
    expect(slugWithSuffix("spring-sale", "4F2A")).toBe("spring-sale-4f2a");
  });

  it("keeps long slugs within the limit and the pattern", () => {
    const long = slugify("x".repeat(80));
    const result = slugWithSuffix(long, "abcd");
    expect(result.length).toBe(SLUG_MAX_LENGTH);
    expect(result).toMatch(SLUG_PATTERN);
    expect(slugWithSuffix(`${"y".repeat(74)}-zz`, "abcd")).toMatch(SLUG_PATTERN);
  });
});
