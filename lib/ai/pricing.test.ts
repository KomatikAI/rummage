import { describe, expect, it } from "vitest";
import { PRICING_MODEL } from "./openrouter";
import {
  buildPricingRequest,
  priceFromPhoto,
  PricingError,
  PRICING_EFFORT,
  PRICING_MAX_TOKENS,
  PRICING_SYSTEM_PROMPT,
} from "./pricing";
import { listingDraftJsonSchema } from "./schemas";
import { finishedResult, structuredModel, systemText, textResult, userParts, validDraft } from "./test-utils";

const input = {
  imageBase64: "aGVsbG8=",
  mediaType: "image/jpeg" as const,
  sellerHint: "used for one kid",
  saleContext: "Maple Street school fundraiser",
};

describe("buildPricingRequest", () => {
  it("asks Terra for a strict listing draft with medium reasoning", () => {
    const call = buildPricingRequest(input);
    expect(PRICING_MODEL).toBe("openai/gpt-6.1-terra");
    expect(call.effort).toBe("medium");
    expect(PRICING_EFFORT).toBe("medium");
    expect(call.maxOutputTokens).toBe(PRICING_MAX_TOKENS);
    expect(call.maxOutputTokens).toBe(16000);
    expect(call.schemaName).toBe("listing_draft");
    expect(call.schema).toBe(listingDraftJsonSchema);
    expect(call.system).toBe(PRICING_SYSTEM_PROMPT);
  });

  it("sends one image part followed by one text part", () => {
    const call = buildPricingRequest(input);
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe("user");
    const content = call.messages[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "file", data: "aGVsbG8=", mediaType: "image/jpeg" });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("used for one kid");
    expect(content[1].text).toContain("Maple Street school fundraiser");
  });

  it("omits blank hints", () => {
    const call = buildPricingRequest({ ...input, sellerHint: "  ", saleContext: undefined });
    const text = (call.messages[0].content as Array<{ text?: string }>)[1].text;
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
  it("returns the validated draft and sends the schema, prompt and reasoning effort", async () => {
    const model = structuredModel(textResult(JSON.stringify(validDraft)));
    await expect(priceFromPhoto(input, { model })).resolves.toEqual(validDraft);
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call.responseFormat).toMatchObject({ type: "json", name: "listing_draft", schema: listingDraftJsonSchema });
    expect(call.maxOutputTokens).toBe(16000);
    expect(call.providerOptions).toEqual({ openrouter: { reasoning: { effort: "medium" } } });
    expect(systemText(call)).toBe(PRICING_SYSTEM_PROMPT);
    const parts = userParts(call);
    expect(parts.map((part) => part.type)).toEqual(["file", "text"]);
    expect(parts[0]).toMatchObject({ mediaType: "image/jpeg", data: { type: "data", data: "aGVsbG8=" } });
  });

  it("throws a typed refusal error on a content-filter stop", async () => {
    const model = structuredModel(finishedResult(JSON.stringify(validDraft), "content-filter"));
    const error = await priceFromPhoto(input, { model }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PricingError);
    expect((error as PricingError).code).toBe("refusal");
    expect((error as PricingError).stopReason).toBe("content-filter");
  });

  it("throws on max_tokens even when the JSON is complete", async () => {
    const model = structuredModel(finishedResult(JSON.stringify(validDraft), "length"));
    await expect(priceFromPhoto(input, { model })).rejects.toMatchObject({
      name: "PricingError",
      code: "max_tokens",
      stopReason: "length",
    });
  });

  it("throws max_tokens when a cut-off reply is not even JSON", async () => {
    const model = structuredModel(finishedResult('{"title":', "length"));
    await expect(priceFromPhoto(input, { model })).rejects.toMatchObject({ code: "max_tokens" });
  });

  it("throws invalid_json for non-JSON text", async () => {
    const model = structuredModel(textResult("not json"));
    await expect(priceFromPhoto(input, { model })).rejects.toMatchObject({ code: "invalid_json" });
  });

  it("throws invalid_output when the JSON breaks the price ordering", async () => {
    const bad = { ...validDraft, price_suggested: 99 };
    const model = structuredModel(textResult(JSON.stringify(bad)));
    const error = (await priceFromPhoto(input, { model }).catch((e: unknown) => e)) as PricingError;
    expect(error.code).toBe("invalid_output");
    expect(Array.isArray(error.issues)).toBe(true);
  });

  it("throws no_output when the reply has no text", async () => {
    const model = structuredModel({ ...textResult(""), content: [] });
    await expect(priceFromPhoto(input, { model })).rejects.toMatchObject({ code: "no_output" });
  });

  it("lets a transport error through untouched", async () => {
    const model = structuredModel(new Error("overloaded"));
    await expect(priceFromPhoto(input, { model })).rejects.toThrow("overloaded");
  });

  it("rejects an empty image without calling the model", async () => {
    const model = structuredModel(textResult("{}"));
    await expect(priceFromPhoto({ ...input, imageBase64: "" }, { model })).rejects.toBeInstanceOf(PricingError);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
