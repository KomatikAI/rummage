import { describe, expect, it } from "vitest";

import { SCAN_MODEL } from "./openrouter";
import {
  buildScanRequest,
  candidateLabel,
  clampBox,
  matchFrameToListings,
  sanitizeScanReply,
  SCAN_EFFORT,
  SCAN_MAX_CANDIDATES,
  SCAN_MAX_TOKENS,
  ScanMatchError,
  type ScanCandidate,
} from "./scan-match";
import { scanReplyJsonSchema } from "./scan-schema";
import { finishedResult, structuredModel, textResult, userParts } from "./test-utils";

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

function scanReply(value: unknown) {
  return structuredModel(textResult(JSON.stringify(value)));
}

const NO_MATCH = { match: null, alternatives: [], not_listed: null };

function userContent(candidates: ScanCandidate[]): Array<Record<string, unknown>> {
  return buildScanRequest(input(candidates)).messages[0].content as Array<Record<string, unknown>>;
}

describe("buildScanRequest", () => {
  it("uses Luna with low effort, the token cap and the strict schema", () => {
    const call = buildScanRequest(input([candidate(1)]));
    expect(SCAN_MODEL).toBe("openai/gpt-6-luna");
    expect(call.maxOutputTokens).toBe(SCAN_MAX_TOKENS);
    expect(call.effort).toBe(SCAN_EFFORT);
    expect(SCAN_EFFORT).toBe("low");
    expect(call.schemaName).toBe("scan_reply");
    expect(call.schema).toBe(scanReplyJsonSchema);
    expect(typeof call.system).toBe("string");
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]?.role).toBe("user");
  });

  it("orders label, photo per candidate, then the frame, then the instruction", () => {
    const content = userContent([candidate(1), candidate(2)]);
    expect(content.map((part) => part.type)).toEqual(["text", "file", "text", "file", "file", "text"]);
    expect(content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/^Item 1: id=item-1, title=Item 1, price=\$5\.00/) });
    expect(content[1]).toEqual({ type: "file", data: new URL("https://photos.example.test/item-1.jpg"), mediaType: "image/*" });
    expect(content[2]).toMatchObject({ type: "text", text: expect.stringMatching(/^Item 2: id=item-2/) });
    expect(content[4]).toEqual({ type: "file", data: FRAME, mediaType: "image/jpeg" });
    expect(content[5]).toMatchObject({ type: "text" });
  });

  it("keeps the label but skips the image for a candidate without a photo", () => {
    const content = userContent([candidate(1), candidate(2, { photoUrl: null })]);
    expect(content.map((part) => part.type)).toEqual(["text", "file", "text", "file", "text"]);
    expect((content[2] as { text: string }).text).toContain("(no photo)");
  });

  it("says nothing is listed when there are no candidates", () => {
    const content = userContent([]);
    expect(content.map((part) => part.type)).toEqual(["text", "file", "text"]);
    expect(content[0].text).toBe("No items are listed at this table.");
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
  it("returns a sanitized match and sends photo URLs through untouched", async () => {
    const model = scanReply({
      match: { item_id: "item-2", confidence: "high", box: { x: 0.4, y: 0.3, w: 0.9, h: 0.2 } },
      alternatives: ["item-1", "made-up"],
      not_listed: null,
    });
    const result = await matchFrameToListings(input([candidate(1), candidate(2)]), { model });
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call.responseFormat).toMatchObject({ type: "json", name: "scan_reply", schema: scanReplyJsonSchema });
    expect(call.maxOutputTokens).toBe(SCAN_MAX_TOKENS);
    expect(call.providerOptions).toEqual({ openrouter: { reasoning: { effort: "low" } } });
    const parts = userParts(call);
    expect(parts.map((part) => part.type)).toEqual(["text", "file", "text", "file", "file", "text"]);
    expect(parts[1]).toMatchObject({ data: { type: "url", url: new URL("https://photos.example.test/item-1.jpg") } });
    expect(parts[4]).toMatchObject({ mediaType: "image/jpeg", data: { type: "data", data: FRAME } });
    expect(result).toEqual({
      match: { itemId: "item-2", confidence: "high", box: { x: 0.4, y: 0.3, w: 0.6, h: 0.2 } },
      alternatives: ["item-1"],
      notListed: null,
    });
  });

  it("returns an estimate when nothing matched", async () => {
    const model = scanReply({ match: null, alternatives: [], not_listed: { title: "Desk fan", price_low: 5, price_high: 10 } });
    const result = await matchFrameToListings(input([candidate(1)]), { model });
    expect(result).toEqual({ match: null, alternatives: [], notListed: { title: "Desk fan", priceLow: 5, priceHigh: 10 } });
  });

  it(`refuses more than ${SCAN_MAX_CANDIDATES} candidates before calling the model`, async () => {
    const model = scanReply(NO_MATCH);
    const many = Array.from({ length: SCAN_MAX_CANDIDATES + 1 }, (_, i) => candidate(i + 1));
    await expect(matchFrameToListings(input(many), { model })).rejects.toMatchObject({
      name: "ScanMatchError",
      code: "too_many_candidates",
    });
    expect(model.doGenerateCalls).toHaveLength(0);
    const exactly = many.slice(0, SCAN_MAX_CANDIDATES);
    await expect(matchFrameToListings(input(exactly), { model })).resolves.toMatchObject({ match: null });
  });

  it("refuses an empty frame", async () => {
    const model = scanReply(NO_MATCH);
    await expect(matchFrameToListings({ ...input([]), frameBase64: "" }, { model })).rejects.toMatchObject({ code: "no_frame" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it.each([
    ["content-filter", "refusal"],
    ["length", "max_tokens"],
  ] as const)("maps a %s stop to %s", async (stopReason, code) => {
    const model = structuredModel(finishedResult(JSON.stringify(NO_MATCH), stopReason));
    const error = await matchFrameToListings(input([candidate(1)]), { model }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanMatchError);
    expect(error).toMatchObject({ code, stopReason });
  });

  it("fails on a reply with no text", async () => {
    const model = structuredModel({ ...textResult(""), content: [] });
    await expect(matchFrameToListings(input([candidate(1)]), { model })).rejects.toMatchObject({ code: "no_output" });
  });

  it("fails on invalid JSON", async () => {
    const model = structuredModel(textResult("{ not json"));
    await expect(matchFrameToListings(input([candidate(1)]), { model })).rejects.toMatchObject({ code: "invalid_json" });
  });

  it("fails on a reply that does not match the schema", async () => {
    const model = scanReply({ match: { item_id: "item-1", confidence: "certain", box: null }, alternatives: [], not_listed: null });
    const error = await matchFrameToListings(input([candidate(1)]), { model }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_output" });
    expect((error as ScanMatchError).issues).toBeTruthy();
  });

  it("rejects extra keys (the schema is strict)", async () => {
    const model = scanReply({ ...NO_MATCH, note: "hello" });
    await expect(matchFrameToListings(input([candidate(1)]), { model })).rejects.toMatchObject({ code: "invalid_output" });
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
