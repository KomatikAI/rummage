/**
 * Test-only helpers for lane D: a valid ListingDraft fixture and canned
 * `MockLanguageModelV4` results. Not exported from `index.ts`.
 */

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
