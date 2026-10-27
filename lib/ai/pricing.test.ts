import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildPricingRequest,
  priceFromPhoto,
  PricingError,
  PRICING_SYSTEM_PROMPT,
  type PricingClient,
} from "./pricing";
import { listingDraftOutputFormat } from "./schemas";
import { validDraft } from "./test-utils";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Builds a fake Messages API response. Cast: tests fill only the fields pricing reads. */
function fakeMessage(overrides: Partial<BetaMessage> & { text?: string }): BetaMessage {
  const { text, ...rest } = overrides;
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: text === undefined ? [] : [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...rest,
  } as unknown as BetaMessage;
}

function fakeClient(response: BetaMessage) {
  const create = vi.fn<(params: CreateParams) => Promise<BetaMessage>>(async () => response);
  const client: PricingClient = { beta: { messages: { create } } };
  return { client, create };
}

const input = {
  imageBase64: "aGVsbG8=",
  mediaType: "image/jpeg" as const,
  sellerHint: "used for one kid",
  saleContext: "Maple Street school fundraiser",
};

function contentOf(req: CreateParams): Array<Record<string, unknown>> {
  return req.messages[0].content as unknown as Array<Record<string, unknown>>;
}

describe("buildPricingRequest", () => {
  it("uses Opus 5.5 with adaptive thinking, structured output and fallbacks", () => {
    const req = buildPricingRequest(input);
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config).toEqual({ effort: "medium", format: listingDraftOutputFormat });
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.max_tokens).toBe(16000);
    expect(req.system).toBe(PRICING_SYSTEM_PROMPT);
  });

  it("sends one image block followed by one text block", () => {
    const req = buildPricingRequest(input);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    const content = contentOf(req);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" },
    });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("used for one kid");
    expect(content[1].text).toContain("Maple Street school fundraiser");
  });

  it("omits blank hints", () => {
    const req = buildPricingRequest({ ...input, sellerHint: "  ", saleContext: undefined });
    const text = contentOf(req)[1].text;
    expect(text).not.toContain("Seller's note");
    expect(text).not.toContain("About the sale");
  });

  it("states the guidance-only rule and the PayPal AUP categories", () => {
    for (const phrase of [
      "guidance only",
      "seller decides",
      "Acceptable Use Policy",
      "weapons and ammunition",
      "drug paraphernalia",
      "tobacco and vaping",
      "alcohol",
      "counterfeit or replica",
      "recall",
      "prescription",
      "illegal activity",
      "adult content",
      "Do not estimate how accurate",
    ]) {
      expect(PRICING_SYSTEM_PROMPT).toContain(phrase);
    }
  });
});

describe("priceFromPhoto", () => {
  it("returns the validated draft and sends the built request", async () => {
    const { client, create } = fakeClient(fakeMessage({ text: JSON.stringify(validDraft) }));
    await expect(priceFromPhoto(input, { client })).resolves.toEqual(validDraft);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual(buildPricingRequest(input));
  });

  it("ignores thinking blocks and reads the text block", async () => {
    const response = fakeMessage({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: JSON.stringify(validDraft), citations: null },
      ] as unknown as BetaMessage["content"],
    });
    const { client } = fakeClient(response);
    await expect(priceFromPhoto(input, { client })).resolves.toEqual(validDraft);
  });

  it("throws a typed refusal error with stop details", async () => {
    const stopDetails = { type: "refusal", category: null, explanation: "declined" };
    const { client } = fakeClient(
      fakeMessage({
        stop_reason: "refusal",
        stop_details: stopDetails as unknown as BetaMessage["stop_details"],
      }),
    );
    const error = await priceFromPhoto(input, { client }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PricingError);
    expect((error as PricingError).code).toBe("refusal");
    expect((error as PricingError).stopReason).toBe("refusal");
    expect((error as PricingError).stopDetails).toEqual(stopDetails);
  });

  it("throws on max_tokens even when partial text exists", async () => {
    const { client } = fakeClient(fakeMessage({ stop_reason: "max_tokens", text: '{"title":' }));
    await expect(priceFromPhoto(input, { client })).rejects.toMatchObject({
      name: "PricingError",
      code: "max_tokens",
    });
  });

  it("throws on a context-window stop", async () => {
    const { client } = fakeClient(fakeMessage({ stop_reason: "model_context_window_exceeded" }));
    await expect(priceFromPhoto(input, { client })).rejects.toMatchObject({
      code: "context_window_exceeded",
    });
  });

  it("throws invalid_json for non-JSON text", async () => {
    const { client } = fakeClient(fakeMessage({ text: "not json" }));
    await expect(priceFromPhoto(input, { client })).rejects.toMatchObject({ code: "invalid_json" });
  });

  it("throws invalid_output when the JSON breaks the price ordering", async () => {
    const bad = { ...validDraft, price_suggested: 99 };
    const { client } = fakeClient(fakeMessage({ text: JSON.stringify(bad) }));
    const error = (await priceFromPhoto(input, { client }).catch((e: unknown) => e)) as PricingError;
    expect(error.code).toBe("invalid_output");
    expect(Array.isArray(error.issues)).toBe(true);
  });

  it("throws no_output when there is no text block", async () => {
    const { client } = fakeClient(fakeMessage({}));
    await expect(priceFromPhoto(input, { client })).rejects.toMatchObject({ code: "no_output" });
  });

  it("rejects an empty image without calling the API", async () => {
    const { client, create } = fakeClient(fakeMessage({ text: "{}" }));
    await expect(
      priceFromPhoto({ ...input, imageBase64: "" }, { client }),
    ).rejects.toBeInstanceOf(PricingError);
    expect(create).not.toHaveBeenCalled();
  });
});
