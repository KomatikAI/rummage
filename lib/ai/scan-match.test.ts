import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import type { PricingClient } from "./pricing";
import {
  buildScanRequest,
  candidateLabel,
  clampBox,
  matchFrameToListings,
  sanitizeScanReply,
  SCAN_EFFORT,
  SCAN_MAX_CANDIDATES,
  SCAN_MAX_TOKENS,
  SCAN_MODEL,
  ScanMatchError,
  type ScanCandidate,
} from "./scan-match";
import { scanReplyJsonSchema } from "./scan-schema";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

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

function candidate(n: number, overrides: Partial<ScanCandidate> = {}): ScanCandidate {
  return {
    id: `item-${n}`,
    title: `Item ${n}`,
    description: null,
    category: "home",
    condition: "good",
    price: 5,
    photoUrl: `https://photos.example.test/item-${n}.jpg`,
    status: "available",
    ...overrides,
  };
}

const FRAME = "aGVsbG8=";

function input(candidates: ScanCandidate[]) {
  return { frameBase64: FRAME, mediaType: "image/jpeg" as const, candidates };
}

function reply(value: unknown): string {
  return JSON.stringify(value);
}

const NO_MATCH = { match: null, alternatives: [], not_listed: null };

function userContent(params: CreateParams): Block[] {
  const message = params.messages[0];
  if (!message || !Array.isArray(message.content)) throw new Error("expected block content");
  // buildScanRequest only ever sends content blocks.
  return message.content as Block[];
}

describe("buildScanRequest", () => {
  it("sends model, effort, adaptive thinking, the fallback beta and the schema", () => {
    const params = buildScanRequest(input([candidate(1)]));
    expect(params.model).toBe(SCAN_MODEL);
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(SCAN_MAX_TOKENS);
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({
      effort: SCAN_EFFORT,
      format: { type: "json_schema", schema: scanReplyJsonSchema },
    });
    expect(SCAN_EFFORT).toBe("low");
    expect(typeof params.system).toBe("string");
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]?.role).toBe("user");
  });

  it("orders label, photo per candidate, then the frame, then the instruction", () => {
    const content = userContent(buildScanRequest(input([candidate(1), candidate(2)])));
    expect(content.map((block) => block.type)).toEqual(["text", "image", "text", "image", "image", "text"]);
    expect(content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/^Item 1: id=item-1, title=Item 1, price=\$5\.00/) });
    expect(content[1]).toMatchObject({ type: "image", source: { type: "url", url: "https://photos.example.test/item-1.jpg" } });
    expect(content[2]).toMatchObject({ type: "text", text: expect.stringMatching(/^Item 2: id=item-2/) });
    expect(content[4]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: FRAME } });
    expect(content[5]).toMatchObject({ type: "text" });
  });

  it("puts the only cache breakpoint on the last candidate block", () => {
    const content = userContent(buildScanRequest(input([candidate(1), candidate(2)])));
    const marked = content.flatMap((block, index) => ("cache_control" in block && block.cache_control ? [index] : []));
    expect(marked).toEqual([3]);
    expect(content[3]).toMatchObject({ type: "image", cache_control: { type: "ephemeral" } });
  });

  it("keeps the label but skips the image for a candidate without a photo", () => {
    const content = userContent(buildScanRequest(input([candidate(1), candidate(2, { photoUrl: null })])));
    expect(content.map((block) => block.type)).toEqual(["text", "image", "text", "image", "text"]);
    expect(content[2]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect((content[2] as { text: string }).text).toContain("(no photo)");
  });

  it("says nothing is listed when there are no candidates, without a breakpoint", () => {
    const content = userContent(buildScanRequest(input([])));
    expect(content.map((block) => block.type)).toEqual(["text", "image", "text"]);
    expect(content.some((block) => "cache_control" in block && block.cache_control)).toBe(false);
  });
});

describe("candidateLabel", () => {
  it("labels free, unpriced and described items on one line", () => {
    expect(candidateLabel(candidate(1, { price: 0 }), 1)).toContain("price=free");
    expect(candidateLabel(candidate(1, { price: null }), 1)).toContain("price=ask the seller");
    const label = candidateLabel(candidate(1, { description: "Blue\nwith   a chip\n" }), 3);
    expect(label).toContain("Item 3: id=item-1");
    expect(label).toContain("description=Blue with a chip");
    expect(label).not.toContain("\n");
  });
});

describe("clampBox", () => {
  it("clamps a box into the frame", () => {
    expect(clampBox({ x: -0.2, y: 0.5, w: 0.5, h: 0.8 })).toEqual({ x: 0, y: 0.5, w: 0.3, h: 0.5 });
  });

  it("drops a box that is entirely outside or empty", () => {
    expect(clampBox({ x: 1.2, y: 0.2, w: 0.3, h: 0.3 })).toBeNull();
    expect(clampBox({ x: 0.2, y: 0.2, w: 0, h: 0.3 })).toBeNull();
    expect(clampBox({ x: Number.NaN, y: 0.2, w: Number.NaN, h: 0.3 })).toBeNull();
  });
});

describe("sanitizeScanReply", () => {
  const ids = new Set(["item-1", "item-2", "item-3", "item-4", "item-5"]);

  it("demotes a hallucinated match to null", () => {
    const result = sanitizeScanReply(
      { match: { item_id: "item-99", confidence: "high", box: null }, alternatives: [], not_listed: null },
      ids,
    );
    expect(result.match).toBeNull();
  });

  it("filters, dedupes, excludes the match from and caps alternatives", () => {
    const result = sanitizeScanReply(
      {
        match: { item_id: "item-1", confidence: "low", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
        alternatives: ["item-1", "ghost", "item-2", "item-2", "item-3", "item-4", "item-5"],
        not_listed: { title: "Lamp", price_low: 1, price_high: 2 },
      },
      ids,
    );
    expect(result.match).toEqual({ itemId: "item-1", confidence: "low", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
    expect(result.alternatives).toEqual(["item-2", "item-3", "item-4"]);
    // An estimate is only kept when nothing matched.
    expect(result.notListed).toBeNull();
  });

  it("tidies an estimate: swapped bounds, cents, a short title", () => {
    const result = sanitizeScanReply(
      { match: null, alternatives: [], not_listed: { title: `  ${"Brass ".repeat(20)}`, price_low: 12.345, price_high: 4 } },
      ids,
    );
    expect(result.notListed?.priceLow).toBe(4);
    expect(result.notListed?.priceHigh).toBe(12.35);
    expect(result.notListed?.title.length).toBeLessThanOrEqual(60);
  });

  it("drops an estimate without a name and clamps negative prices to zero", () => {
    expect(sanitizeScanReply({ match: null, alternatives: [], not_listed: { title: " ", price_low: 1, price_high: 2 } }, ids).notListed).toBeNull();
    expect(
      sanitizeScanReply({ match: null, alternatives: [], not_listed: { title: "Mug", price_low: -1, price_high: 1 } }, ids).notListed,
    ).toEqual({ title: "Mug", priceLow: 0, priceHigh: 1 });
  });
});

describe("matchFrameToListings", () => {
  it("returns a sanitized match", async () => {
    const { client, create } = fakeClient(
      fakeMessage({
        text: reply({
          match: { item_id: "item-2", confidence: "high", box: { x: 0.4, y: 0.3, w: 0.9, h: 0.2 } },
          alternatives: ["item-1", "made-up"],
          not_listed: null,
        }),
      }),
    );
    const result = await matchFrameToListings(input([candidate(1), candidate(2)]), { client });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      match: { itemId: "item-2", confidence: "high", box: { x: 0.4, y: 0.3, w: 0.6, h: 0.2 } },
      alternatives: ["item-1"],
      notListed: null,
    });
  });

  it("returns an estimate when nothing matched", async () => {
    const { client } = fakeClient(
      fakeMessage({ text: reply({ match: null, alternatives: [], not_listed: { title: "Desk fan", price_low: 5, price_high: 10 } }) }),
    );
    const result = await matchFrameToListings(input([candidate(1)]), { client });
    expect(result).toEqual({ match: null, alternatives: [], notListed: { title: "Desk fan", priceLow: 5, priceHigh: 10 } });
  });

  it(`refuses more than ${SCAN_MAX_CANDIDATES} candidates before calling the API`, async () => {
    const { client, create } = fakeClient(fakeMessage({ text: reply(NO_MATCH) }));
    const many = Array.from({ length: SCAN_MAX_CANDIDATES + 1 }, (_, i) => candidate(i + 1));
    await expect(matchFrameToListings(input(many), { client })).rejects.toMatchObject({
      name: "ScanMatchError",
      code: "too_many_candidates",
    });
    expect(create).not.toHaveBeenCalled();
    const exactly = many.slice(0, SCAN_MAX_CANDIDATES);
    await expect(matchFrameToListings(input(exactly), { client })).resolves.toMatchObject({ match: null });
  });

  it("refuses an empty frame", async () => {
    const { client, create } = fakeClient(fakeMessage({ text: reply(NO_MATCH) }));
    await expect(matchFrameToListings({ ...input([]), frameBase64: "" }, { client })).rejects.toMatchObject({ code: "no_frame" });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["refusal", "refusal"],
    ["max_tokens", "max_tokens"],
    ["model_context_window_exceeded", "context_window_exceeded"],
  ] as const)("maps stop_reason %s to %s", async (stopReason, code) => {
    const { client } = fakeClient(
      fakeMessage({ stop_reason: stopReason as BetaMessage["stop_reason"], text: reply(NO_MATCH) }),
    );
    const error = await matchFrameToListings(input([candidate(1)]), { client }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanMatchError);
    expect(error).toMatchObject({ code, stopReason });
  });

  it("fails on a reply with no text", async () => {
    const { client } = fakeClient(fakeMessage({}));
    await expect(matchFrameToListings(input([candidate(1)]), { client })).rejects.toMatchObject({ code: "no_output" });
  });

  it("fails on invalid JSON", async () => {
    const { client } = fakeClient(fakeMessage({ text: "{ not json" }));
    await expect(matchFrameToListings(input([candidate(1)]), { client })).rejects.toMatchObject({ code: "invalid_json" });
  });

  it("fails on a reply that does not match the schema", async () => {
    const { client } = fakeClient(
      fakeMessage({ text: reply({ match: { item_id: "item-1", confidence: "certain", box: null }, alternatives: [], not_listed: null }) }),
    );
    const error = await matchFrameToListings(input([candidate(1)]), { client }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_output" });
    expect((error as ScanMatchError).issues).toBeTruthy();
  });

  it("rejects extra keys (the schema is strict)", async () => {
    const { client } = fakeClient(fakeMessage({ text: reply({ ...NO_MATCH, note: "hello" }) }));
    await expect(matchFrameToListings(input([candidate(1)]), { client })).rejects.toMatchObject({ code: "invalid_output" });
  });
});

describe("scanReplyJsonSchema", () => {
  it("is a strict object schema without a $schema key", () => {
    expect(scanReplyJsonSchema).not.toHaveProperty("$schema");
    expect(scanReplyJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["match", "alternatives", "not_listed"],
    });
  });
});
