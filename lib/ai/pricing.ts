import type { LanguageModel, ModelMessage } from "ai";

import {
  generateStructured,
  openRouterModel,
  PRICING_MODEL,
  type StructuredCall,
  type StructuredFailureCode,
} from "./openrouter";
import { ListingDraft, listingDraftJsonSchema } from "./schemas";

/**
 * Photo pricing: one seller photo in, one zod-validated `ListingDraft` out.
 * The draft is guidance for the seller, who always sets the final price.
 */

export { PRICING_MODEL };
export const PRICING_EFFORT = "medium" as const;
export const PRICING_MAX_TOKENS = 16000;

export type PricingMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface PriceFromPhotoInput {
  /** Base64 image bytes, without a `data:` prefix. */
  imageBase64: string;
  mediaType: PricingMediaType;
  /** Free text from the seller, e.g. "barely used, original box". */
  sellerHint?: string;
  /** Free text about the sale, e.g. "school fundraiser, suburban Ohio". */
  saleContext?: string;
}

export interface PricingDeps {
  /** Override the model; tests pass a `MockLanguageModelV4`. */
  model?: LanguageModel;
}

export type PricingErrorCode = StructuredFailureCode;

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  readonly stopReason: string | null;
  readonly stopDetails: unknown;
  readonly issues: unknown;

  constructor(
    code: PricingErrorCode,
    message: string,
    extra: { stopReason?: string | null; stopDetails?: unknown; issues?: unknown } = {},
  ) {
    super(message);
    this.name = "PricingError";
    this.code = code;
    this.stopReason = extra.stopReason ?? null;
    this.stopDetails = extra.stopDetails ?? null;
    this.issues = extra.issues ?? null;
  }
}

export const PRICING_SYSTEM_PROMPT = `You help people price items for a US community yard sale. A seller has taken one photo of one item. You draft a listing for them to review.

Pricing:
- Price for US second-hand yard-sale buyers, who expect bargains: typically well below retail and below online resale prices. Round to amounts people actually ask at a yard sale (for example 0.50, 1, 2, 5, 10, 15, 20, 25).
- price_low <= price_suggested <= price_high, in US dollars with at most two decimal places.
- Your price is guidance only. The seller decides the final price, so give a range a seller can reasonably choose from and one plain sentence of reasoning.

What you can claim:
- Describe only what the photo shows and what the seller's note says. Do not invent brand names, model numbers, sizes, materials, working condition or provenance you cannot see.
- Judge condition only as far as the photo allows; when wear cannot be seen, pick the cautious condition.
- Do not estimate how accurate your price is, quote percentages or confidence scores, or cite sales data. confidence_note is one short sentence saying this is a guess from a single photo.

Restricted items:
- Set prohibited_flag to true, and say why in prohibited_reason, when the item falls in a category PayPal's Acceptable Use Policy restricts: weapons and ammunition (including parts and accessories); drugs and drug paraphernalia; tobacco and vaping products; alcohol; counterfeit or replica goods; products under a safety recall (for example recalled infant sleepers, cribs or car seats); prescription or medical devices that require a prescription; items that encourage or facilitate illegal activity; adult content.
- If you are unsure whether an item is restricted, flag it and explain what the seller should check. Still fill in the other fields so the organizer can review it.
- When the item is not restricted, prohibited_flag is false and prohibited_reason is null.

Keep the title under 60 characters and the description under 280 characters. Write for shoppers, in plain language.`;

function buildUserText(input: PriceFromPhotoInput): string {
  const parts = ["Draft a yard-sale listing for the item in this photo."];
  if (input.sellerHint && input.sellerHint.trim()) {
    parts.push(`Seller's note: ${input.sellerHint.trim()}`);
  }
  if (input.saleContext && input.saleContext.trim()) {
    parts.push(`About the sale: ${input.saleContext.trim()}`);
  }
  return parts.join("\n\n");
}

/** Builds the exact request; exported so tests can inspect it. */
export function buildPricingRequest(input: PriceFromPhotoInput): StructuredCall {
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "file", data: input.imageBase64, mediaType: input.mediaType },
        { type: "text", text: buildUserText(input) },
      ],
    },
  ];
  return {
    system: PRICING_SYSTEM_PROMPT,
    messages,
    maxOutputTokens: PRICING_MAX_TOKENS,
    effort: PRICING_EFFORT,
    schemaName: "listing_draft",
    schema: listingDraftJsonSchema,
  };
}

/** Prices one item from one photo. Throws `PricingError` on any unusable reply. */
export async function priceFromPhoto(
  input: PriceFromPhotoInput,
  deps: PricingDeps = {},
): Promise<ListingDraft> {
  if (!input.imageBase64) {
    throw new PricingError("no_output", "imageBase64 is empty");
  }
  const model = deps.model ?? openRouterModel(PRICING_MODEL);
  const result = await generateStructured(model, buildPricingRequest(input), (raw) =>
    ListingDraft.safeParse(raw),
  );
  if (!result.ok) {
    throw new PricingError(result.code, `Pricing: ${result.message}`, {
      stopReason: result.stopReason,
      stopDetails: result.code === "refusal" ? result.details : undefined,
      issues: result.code === "invalid_output" ? result.details : undefined,
    });
  }
  return result.value;
}
