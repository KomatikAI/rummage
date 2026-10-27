import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { ListingDraft, listingDraftOutputFormat } from "./schemas";

/**
 * Photo pricing: one seller photo in, one zod-validated `ListingDraft` out.
 * The draft is guidance for the seller, who always sets the final price.
 */

export const PRICING_MODEL = "claude-opus-5-5";
/** Server-side fallback beta: a refused request is retried on a fallback model. */
export const PRICING_FALLBACK_BETA = "server-side-fallback-2026-07-01";
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

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

/** The slice of the Anthropic client pricing uses; tests pass a fake. */
export interface PricingClient {
  beta: {
    messages: {
      create(params: CreateParams): PromiseLike<BetaMessage>;
    };
  };
}

export interface PricingDeps {
  client?: PricingClient;
}

export type PricingErrorCode =
  | "refusal"
  | "max_tokens"
  | "context_window_exceeded"
  | "no_output"
  | "invalid_json"
  | "invalid_output";

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

/** Builds the exact Messages API request; exported so tests can inspect it. */
export function buildPricingRequest(input: PriceFromPhotoInput): CreateParams {
  return {
    model: PRICING_MODEL,
    max_tokens: PRICING_MAX_TOKENS,
    betas: [PRICING_FALLBACK_BETA],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: listingDraftOutputFormat,
    },
    system: PRICING_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mediaType,
              data: input.imageBase64,
            },
          },
          { type: "text", text: buildUserText(input) },
        ],
      },
    ],
  };
}

let defaultClient: PricingClient | undefined;

function getDefaultClient(): PricingClient {
  defaultClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return defaultClient;
}

/** Prices one item from one photo. Throws `PricingError` on any unusable reply. */
export async function priceFromPhoto(
  input: PriceFromPhotoInput,
  deps: PricingDeps = {},
): Promise<ListingDraft> {
  if (!input.imageBase64) {
    throw new PricingError("no_output", "imageBase64 is empty");
  }
  const client = deps.client ?? getDefaultClient();
  const response = await client.beta.messages.create(buildPricingRequest(input));

  switch (response.stop_reason) {
    case "refusal":
      throw new PricingError("refusal", "Claude declined to price this photo", {
        stopReason: response.stop_reason,
        stopDetails: response.stop_details,
      });
    case "max_tokens":
      throw new PricingError(
        "max_tokens",
        "The pricing reply was cut off at max_tokens",
        { stopReason: response.stop_reason },
      );
    case "model_context_window_exceeded":
      throw new PricingError(
        "context_window_exceeded",
        "The pricing request exceeded the model context window",
        { stopReason: response.stop_reason },
      );
    default:
      break;
  }

  const text = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  if (!text.trim()) {
    throw new PricingError("no_output", "The pricing reply had no text block", {
      stopReason: response.stop_reason,
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PricingError("invalid_json", "The pricing reply was not valid JSON", {
      stopReason: response.stop_reason,
    });
  }

  const parsed = ListingDraft.safeParse(raw);
  if (!parsed.success) {
    throw new PricingError(
      "invalid_output",
      "The pricing reply did not match the ListingDraft schema",
      { stopReason: response.stop_reason, issues: parsed.error.issues },
    );
  }
  return parsed.data;
}
