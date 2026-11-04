import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCREEN_MODEL } from "./openrouter";
import {
  buildScreenRequest,
  detectImageMediaType,
  listingScreenJsonSchema,
  screenListing,
  SCREEN_DEFAULT_REASON,
  SCREEN_EFFORT,
  SCREEN_SYSTEM_PROMPT,
  SCREEN_UNCHECKED_REASON,
} from "./screen-listing";
import { finishedResult, structuredModel, textResult, userParts } from "./test-utils";

const withPhoto = {
  title: "Wooden high chair",
  description: "Solid wood, light scuffs.",
  category: "kids",
  imageBase64: "aGVsbG8=",
  mediaType: "image/jpeg" as const,
};

const textOnly = { title: "Box of paperbacks", description: null, category: "books" };

function contentOf(input: typeof withPhoto | typeof textOnly): Array<Record<string, unknown>> {
  return buildScreenRequest(input).messages[0].content as Array<Record<string, unknown>>;
}

function screenReply(value: unknown) {
  return structuredModel(textResult(JSON.stringify(value)));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("buildScreenRequest", () => {
  it("uses Terra with low reasoning effort and the strict screen schema", () => {
    const call = buildScreenRequest(withPhoto);
    expect(SCREEN_MODEL).toBe("openai/gpt-6.1-terra");
    expect(call.effort).toBe("low");
    expect(SCREEN_EFFORT).toBe("low");
    expect(call.schemaName).toBe("listing_screen");
    expect(call.schema).toBe(listingScreenJsonSchema);
    expect(call.system).toBe(SCREEN_SYSTEM_PROMPT);
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
    const content = contentOf(withPhoto);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "file", data: "aGVsbG8=", mediaType: "image/jpeg" });
    expect(content[1].text).toContain("Title: Wooden high chair");
    expect(content[1].text).toContain("Category: kids");
    expect(content[1].text).toContain("Description: Solid wood, light scuffs.");
  });

  it("sends text only when there is no photo", () => {
    const content = contentOf(textOnly);
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
  it("passes an allowed item and sends the schema with low effort", async () => {
    const model = screenReply({ prohibited: false, reason: null });
    await expect(screenListing(withPhoto, { model })).resolves.toEqual({ prohibited: false, reason: null, checked: true });
    const call = model.doGenerateCalls[0];
    expect(call.responseFormat).toMatchObject({ type: "json", name: "listing_screen", schema: listingScreenJsonSchema });
    expect(call.providerOptions).toEqual({ openrouter: { reasoning: { effort: "low" } } });
    expect(userParts(call).map((part) => part.type)).toEqual(["file", "text"]);
  });

  it("drops a stray reason on an allowed item", async () => {
    const model = screenReply({ prohibited: false, reason: "fine" });
    await expect(screenListing(textOnly, { model })).resolves.toEqual({ prohibited: false, reason: null, checked: true });
  });

  it("returns the model's reason for a flagged item", async () => {
    const reason = "A used car seat with no crash history cannot be sold here.";
    const model = screenReply({ prohibited: true, reason });
    await expect(screenListing(withPhoto, { model })).resolves.toEqual({ prohibited: true, reason, checked: true });
  });

  it("fills in a reason when the model flags without one", async () => {
    const model = screenReply({ prohibited: true, reason: null });
    await expect(screenListing(withPhoto, { model })).resolves.toEqual({
      prohibited: true,
      reason: SCREEN_DEFAULT_REASON,
      checked: true,
    });
  });

  const failClosed = { prohibited: true, reason: SCREEN_UNCHECKED_REASON, checked: false };

  it("fails closed when the API call throws", async () => {
    const model = structuredModel(new Error("overloaded"));
    await expect(screenListing(withPhoto, { model })).resolves.toEqual(failClosed);
  });

  it.each(["content-filter", "length"] as const)("fails closed on a %s stop", async (reason) => {
    const model = structuredModel(finishedResult(JSON.stringify({ prohibited: false, reason: null }), reason));
    await expect(screenListing(withPhoto, { model })).resolves.toEqual(failClosed);
  });

  it("fails closed on no text, bad JSON or the wrong shape", async () => {
    for (const result of [
      { ...textResult(""), content: [] },
      textResult("not json"),
      textResult(JSON.stringify({ prohibited: "no" })),
    ]) {
      const model = structuredModel(result);
      await expect(screenListing(withPhoto, { model })).resolves.toEqual(failClosed);
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
