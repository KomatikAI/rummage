import { describe, expect, it } from "vitest";
import {
  hasAtMostTwoDecimals,
  ListingDraft,
  listingDraftJsonSchema,
  listingDraftOutputFormat,
  LISTING_CATEGORIES,
} from "./schemas";
import { validDraft } from "./test-utils";

describe("ListingDraft", () => {
  it("accepts a valid draft", () => {
    expect(ListingDraft.parse(validDraft)).toEqual(validDraft);
  });

  it("accepts low = suggested = high", () => {
    const draft = { ...validDraft, price_low: 5, price_suggested: 5, price_high: 5 };
    expect(ListingDraft.safeParse(draft).success).toBe(true);
  });

  it("accepts cents and boundary lengths", () => {
    const draft = {
      ...validDraft,
      title: "t".repeat(60),
      description: "d".repeat(280),
      price_low: 0.5,
      price_suggested: 0.75,
      price_high: 1.25,
    };
    expect(ListingDraft.safeParse(draft).success).toBe(true);
  });

  it("rejects a title over 60 characters", () => {
    expect(ListingDraft.safeParse({ ...validDraft, title: "t".repeat(61) }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(ListingDraft.safeParse({ ...validDraft, title: "" }).success).toBe(false);
  });

  it("rejects a description over 280 characters", () => {
    const draft = { ...validDraft, description: "d".repeat(281) };
    expect(ListingDraft.safeParse(draft).success).toBe(false);
  });

  it("rejects more than two decimal places", () => {
    expect(ListingDraft.safeParse({ ...validDraft, price_suggested: 15.005 }).success).toBe(false);
  });

  it("rejects negative prices", () => {
    expect(ListingDraft.safeParse({ ...validDraft, price_low: -1 }).success).toBe(false);
  });

  it("rejects low above suggested", () => {
    const result = ListingDraft.safeParse({ ...validDraft, price_low: 20 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["price_low"]);
  });

  it("rejects suggested above high", () => {
    const result = ListingDraft.safeParse({ ...validDraft, price_suggested: 30 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["price_high"]);
  });

  it("rejects unknown category and condition values", () => {
    expect(ListingDraft.safeParse({ ...validDraft, category: "toys" }).success).toBe(false);
    expect(ListingDraft.safeParse({ ...validDraft, condition: "mint" }).success).toBe(false);
  });

  it("requires a reason when flagged and none when not", () => {
    expect(ListingDraft.safeParse({ ...validDraft, prohibited_flag: true }).success).toBe(false);
    expect(
      ListingDraft.safeParse({ ...validDraft, prohibited_reason: "looks like a vape" }).success,
    ).toBe(false);
    expect(
      ListingDraft.safeParse({
        ...validDraft,
        prohibited_flag: true,
        prohibited_reason: "Vaping products are restricted by PayPal's Acceptable Use Policy.",
      }).success,
    ).toBe(true);
  });

  it("rejects a missing field", () => {
    const rest: Record<string, unknown> = { ...validDraft };
    delete rest.confidence_note;
    expect(ListingDraft.safeParse(rest).success).toBe(false);
  });
});

describe("hasAtMostTwoDecimals", () => {
  it("handles float noise and non-finite values", () => {
    expect(hasAtMostTwoDecimals(0.1 + 0.2)).toBe(true);
    expect(hasAtMostTwoDecimals(19.99)).toBe(true);
    expect(hasAtMostTwoDecimals(1.1)).toBe(true);
    expect(hasAtMostTwoDecimals(1.234)).toBe(false);
    expect(hasAtMostTwoDecimals(Number.NaN)).toBe(false);
    expect(hasAtMostTwoDecimals(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("listingDraftJsonSchema", () => {
  const schema = listingDraftJsonSchema as {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, Record<string, unknown>>;
  };

  it("is a closed object requiring every field", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(validDraft).sort());
  });

  it("keeps enums and moves unsupported constraints into descriptions", () => {
    expect(schema.properties.category.enum).toEqual([...LISTING_CATEGORIES]);
    expect(schema.properties.title.maxLength).toBeUndefined();
    expect(schema.properties.title.description).toContain("maxLength: 60");
    expect(schema.properties.price_low.minimum).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain("$schema");
    expect(JSON.stringify(schema)).not.toContain("$ref");
  });

  it("allows null for prohibited_reason", () => {
    expect(schema.properties.prohibited_reason.anyOf).toContainEqual({ type: "null" });
  });

  it("is wrapped as a json_schema output format", () => {
    expect(listingDraftOutputFormat).toEqual({
      type: "json_schema",
      schema: listingDraftJsonSchema,
    });
  });
});
