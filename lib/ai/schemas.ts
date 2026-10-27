import { z } from "zod";

/**
 * Shared zod schemas for lane D (AI). `ListingDraft` is the structured output
 * Claude returns when it prices an item from one seller photo.
 */

export const LISTING_CATEGORIES = [
  "kids",
  "furniture",
  "kitchen",
  "garden",
  "books",
  "sports",
  "clothing",
  "electronics",
  "tools",
  "decor",
  "other",
] as const;

export const LISTING_CONDITIONS = [
  "new",
  "like_new",
  "good",
  "fair",
  "poor",
] as const;

export const ListingCategory = z.enum(LISTING_CATEGORIES);
export type ListingCategory = z.infer<typeof ListingCategory>;

export const ListingCondition = z.enum(LISTING_CONDITIONS);
export type ListingCondition = z.infer<typeof ListingCondition>;

/** True when `value` has at most two decimal places (cents). */
export function hasAtMostTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}

const usd = (what: string) =>
  z
    .number()
    .min(0)
    .describe(`${what}, in US dollars with at most 2 decimal places`)
    .refine(hasAtMostTwoDecimals, {
      message: `${what} must have at most 2 decimal places`,
    });

/**
 * The object shape without cross-field rules. This is what the JSON schema for
 * the structured-output request is generated from (JSON schema cannot express
 * low <= suggested <= high; zod enforces it after parsing).
 */
export const ListingDraftObject = z.object({
  title: z
    .string()
    .min(1)
    .max(60)
    .describe("Short listing title, at most 60 characters"),
  description: z
    .string()
    .min(1)
    .max(280)
    .describe(
      "Plain description of what is visible in the photo, at most 280 characters",
    ),
  category: ListingCategory.describe("Best-fit yard-sale category"),
  condition: ListingCondition.describe("Condition as far as the photo shows"),
  price_low: usd("Low end of the suggested price range"),
  price_high: usd("High end of the suggested price range"),
  price_suggested: usd("Suggested asking price, between price_low and price_high"),
  price_reason: z
    .string()
    .min(1)
    .describe("One sentence explaining the suggested price"),
  prohibited_flag: z
    .boolean()
    .describe(
      "True when the item falls in a category PayPal's Acceptable Use Policy restricts",
    ),
  prohibited_reason: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "Why the item is flagged, or null when prohibited_flag is false",
    ),
  confidence_note: z
    .string()
    .min(1)
    .describe(
      "One short sentence saying this is a guess from a single photo",
    ),
});

export const ListingDraft = ListingDraftObject.superRefine((draft, ctx) => {
  if (draft.price_low > draft.price_suggested) {
    ctx.addIssue({
      code: "custom",
      path: ["price_low"],
      message: "price_low must be less than or equal to price_suggested",
    });
  }
  if (draft.price_suggested > draft.price_high) {
    ctx.addIssue({
      code: "custom",
      path: ["price_high"],
      message: "price_suggested must be less than or equal to price_high",
    });
  }
  if (draft.prohibited_flag && draft.prohibited_reason === null) {
    ctx.addIssue({
      code: "custom",
      path: ["prohibited_reason"],
      message: "prohibited_reason is required when prohibited_flag is true",
    });
  }
  if (!draft.prohibited_flag && draft.prohibited_reason !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["prohibited_reason"],
      message: "prohibited_reason must be null when prohibited_flag is false",
    });
  }
});
export type ListingDraft = z.infer<typeof ListingDraft>;

/**
 * Keywords structured outputs does not enforce. They are moved into the
 * property description so the model still sees them; zod enforces them after
 * parsing. `enum`, `type`, `required`, `anyOf` and `additionalProperties` are
 * kept. (The SDK's `zodOutputFormat` helper also moves `enum` into the
 * description on SDK 1.3.0, which loses the category constraint, so the
 * transform is done here instead.)
 */
const UNSUPPORTED_KEYWORDS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "format",
] as const;

type JsonObject = { [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStructuredOutputSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStructuredOutputSchema);
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  const moved: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) {
      moved.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    out[key] = toStructuredOutputSchema(value);
  }
  if (out.type === "object" && isJsonObject(out.properties)) {
    out.additionalProperties = false;
  }
  if (moved.length > 0) {
    const note = `{${moved.join(", ")}}`;
    out.description =
      typeof out.description === "string" ? `${out.description}

${note}` : note;
  }
  return out;
}

/**
 * JSON schema for `output_config.format`, generated from `ListingDraftObject`
 * with `z.toJSONSchema` (inlined, no `$defs`) and reduced to the keywords
 * structured outputs supports.
 */
export const listingDraftJsonSchema = toStructuredOutputSchema(
  z.toJSONSchema(ListingDraftObject, { reused: "inline", io: "output" }),
) as Record<string, unknown>;

/** The exact `output_config.format` value sent with a pricing request. */
export const listingDraftOutputFormat = {
  type: "json_schema" as const,
  schema: listingDraftJsonSchema,
};
