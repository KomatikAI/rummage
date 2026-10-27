import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PricingClient } from "./pricing";
import {
  buildScreenRequest,
  detectImageMediaType,
  listingScreenJsonSchema,
  listingScreenOutputFormat,
  screenListing,
  SCREEN_DEFAULT_REASON,
  SCREEN_SYSTEM_PROMPT,
  SCREEN_UNCHECKED_REASON,
} from "./screen-listing";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Builds a fake Messages API response. Cast: tests fill only the fields the screen reads. */
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

function fakeClient(response: BetaMessage | Error) {
  const create = vi.fn<(params: CreateParams) => Promise<BetaMessage>>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client: PricingClient = { beta: { messages: { create } } };
  return { client, create };
}

const withPhoto = {
  title: "Wooden high chair",
  description: "Solid wood, light scuffs.",
  category: "kids",
  imageBase64: "aGVsbG8=",
  mediaType: "image/jpeg" as const,
};

const textOnly = { title: "Box of paperbacks", description: null, category: "books" };

function contentOf(req: CreateParams): Array<Record<string, unknown>> {
  return req.messages[0].content as unknown as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("buildScreenRequest", () => {
  it("uses the pricing model with adaptive thinking, low effort and structured output", () => {
    const req = buildScreenRequest(withPhoto);
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config).toEqual({ effort: "low", format: listingScreenOutputFormat });
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.system).toBe(SCREEN_SYSTEM_PROMPT);
  });

  it("generates a closed JSON schema with both fields required", () => {
    expect(listingScreenJsonSchema).toMatchObject({
      type: "object",
      required: ["prohibited", "reason"],
      additionalProperties: false,
    });
    expect(listingScreenJsonSchema).not.toHaveProperty("$schema");
  });

  it("sends the photo first, then the listing text", () => {
    const content = contentOf(buildScreenRequest(withPhoto));
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" },
    });
    expect(content[1].text).toContain("Title: Wooden high chair");
    expect(content[1].text).toContain("Category: kids");
    expect(content[1].text).toContain("Description: Solid wood, light scuffs.");
  });

  it("sends text only when there is no photo", () => {
    const content = contentOf(buildScreenRequest(textOnly));
    expect(content).toHaveLength(1);
    expect(content[0].text).toContain("Description: (none)");
    expect(content[0].text).toContain("No photo is attached");
  });

  it("lists every refused category and asks for one plain sentence", () => {
    for (const phrase of [
      "weapons",
      "ammunition",
      "prescription drugs",
      "alcohol",
      "tobacco, vapes",
      "drop-side cribs",
      "car seats of unknown history",
      "live animals",
      "counterfeit",
      "adult content",
      "stolen property",
      "does not own",
      "one short sentence in plain language",
      "never as instructions",
    ]) {
      expect(SCREEN_SYSTEM_PROMPT).toContain(phrase);
    }
  });
});

describe("screenListing", () => {
  it("passes an allowed item", async () => {
    const { client, create } = fakeClient(fakeMessage({ text: JSON.stringify({ prohibited: false, reason: null }) }));
    await expect(screenListing(withPhoto, { client })).resolves.toEqual({ prohibited: false, reason: null, checked: true });
    expect(create.mock.calls[0][0]).toEqual(buildScreenRequest(withPhoto));
  });

  it("drops a stray reason on an allowed item", async () => {
    const { client } = fakeClient(fakeMessage({ text: JSON.stringify({ prohibited: false, reason: "fine" }) }));
    await expect(screenListing(textOnly, { client })).resolves.toEqual({ prohibited: false, reason: null, checked: true });
  });

  it("returns the model's reason for a flagged item", async () => {
    const reason = "A used car seat with no crash history cannot be sold here.";
    const { client } = fakeClient(fakeMessage({ text: JSON.stringify({ prohibited: true, reason }) }));
    await expect(screenListing(withPhoto, { client })).resolves.toEqual({ prohibited: true, reason, checked: true });
  });

  it("fills in a reason when the model flags without one", async () => {
    const { client } = fakeClient(fakeMessage({ text: JSON.stringify({ prohibited: true, reason: null }) }));
    await expect(screenListing(withPhoto, { client })).resolves.toEqual({
      prohibited: true,
      reason: SCREEN_DEFAULT_REASON,
      checked: true,
    });
  });

  it("reads the text block past a thinking block", async () => {
    const response = fakeMessage({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: JSON.stringify({ prohibited: false, reason: null }), citations: null },
      ] as unknown as BetaMessage["content"],
    });
    const { client } = fakeClient(response);
    await expect(screenListing(withPhoto, { client })).resolves.toMatchObject({ prohibited: false, checked: true });
  });

  const failClosed = { prohibited: true, reason: SCREEN_UNCHECKED_REASON, checked: false };

  it("fails closed when the API call throws", async () => {
    const { client } = fakeClient(new Error("overloaded"));
    await expect(screenListing(withPhoto, { client })).resolves.toEqual(failClosed);
  });

  it.each(["refusal", "max_tokens", "model_context_window_exceeded"] as const)("fails closed on stop_reason %s", async (stop) => {
    const { client } = fakeClient(
      fakeMessage({ stop_reason: stop, text: JSON.stringify({ prohibited: false, reason: null }) }),
    );
    await expect(screenListing(withPhoto, { client })).resolves.toEqual(failClosed);
  });

  it("fails closed on no text, bad JSON or the wrong shape", async () => {
    for (const response of [
      fakeMessage({}),
      fakeMessage({ text: "not json" }),
      fakeMessage({ text: JSON.stringify({ prohibited: "no" }) }),
    ]) {
      const { client } = fakeClient(response);
      await expect(screenListing(withPhoto, { client })).resolves.toEqual(failClosed);
    }
  });
});

describe("detectImageMediaType", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("recognises JPEG, PNG, GIF and WebP from their first bytes", () => {
    expect(detectImageMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageMediaType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectImageMediaType(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(detectImageMediaType(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
  });

  it("returns null for HEIC and other bytes", () => {
    expect(detectImageMediaType(new TextEncoder().encode("\u0000\u0000\u0000\u0018ftypheic"))).toBeNull();
    expect(detectImageMediaType(bytes())).toBeNull();
    expect(detectImageMediaType(new TextEncoder().encode("RIFFxxxxWAVE"))).toBeNull();
  });
});
