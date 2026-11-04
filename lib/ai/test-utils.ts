/**
 * Test-only helpers for lane D: a valid ListingDraft fixture and canned
 * `MockLanguageModelV4` results. Not exported from `index.ts`.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4FinishReason, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

export const validDraft = {
  title: "Wooden high chair",
  description: "Solid wood high chair with tray. Light scuffs on the legs.",
  category: "kids",
  condition: "good",
  price_low: 10,
  price_high: 25,
  price_suggested: 15,
  price_reason: "Sturdy wooden high chairs sell quickly at yard sales for $10 to $25.",
  prohibited_flag: false,
  prohibited_reason: null,
  confidence_note: "This is a guess from a single photo.",
} as const;

export const mockUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: mockUsage,
    warnings: [],
  };
}

/** A reply of `text` ending for `reason`, as the structured-output modules see it. */
export function finishedResult(text: string, reason: LanguageModelV4FinishReason["unified"]) {
  return { ...textResult(text), finishReason: { unified: reason, raw: undefined } };
}

/**
 * A mock model for the structured-output modules (pricing, screen, scan). It accepts
 * https image URLs as-is so the SDK never tries to download a candidate photo, and it
 * records every call in `doGenerateCalls`. Pass an `Error` to make the call throw.
 */
export function structuredModel(result: LanguageModelV4GenerateResult | Error) {
  return new MockLanguageModelV4({
    provider: "openrouter",
    modelId: "mock",
    supportedUrls: { "image/*": [/^https?:\/\//] },
    doGenerate: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  });
}

/** The content parts of the single user message a structured call sends. */
export function userParts(call: LanguageModelV4CallOptions): Array<Record<string, unknown>> {
  const user = call.prompt.find((message) => message.role === "user");
  if (!user || typeof user.content === "string") throw new Error("expected a user message with parts");
  return user.content as unknown as Array<Record<string, unknown>>;
}

/** The system prompt a structured call sends. */
export function systemText(call: LanguageModelV4CallOptions): string | undefined {
  const system = call.prompt.find((message) => message.role === "system");
  return system && typeof system.content === "string" ? system.content : undefined;
}

let callCounter = 0;

export function toolCallResult(toolName: string, input: unknown) {
  callCounter += 1;
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `call-${callCounter}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: mockUsage,
    warnings: [],
  };
}

/** Options object for calling a tool's `execute` directly in a test. */
export const execOptions = {
  toolCallId: "test-call",
  messages: [],
  context: {},
};
