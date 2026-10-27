import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  CART_PATH,
  generateShoppingReply,
  runShoppingAssistant,
  shoppingSystemPrompt,
  SHOPPING_MAX_STEPS,
} from "./shopping-assistant";
import type { ItemsRepo } from "./shopping-tools";
import { mockUsage, textResult, toolCallResult } from "./test-utils";

function fakeRepo(): ItemsRepo {
  return {
    searchItems: vi.fn(async () => []),
    holdItem: vi.fn(async (itemId: string, cartId: string) => ({
      ok: true as const,
      itemId,
      cartId,
      expiresAt: "2026-10-27T18:15:00Z",
    })),
    releaseHold: vi.fn(async (itemId: string, cartId: string) => ({
      ok: true as const,
      itemId,
      cartId,
    })),
    getCart: vi.fn(async () => ({ cartId: "cart-1", lines: [], subtotal: 0 })),
  };
}

const baseInput = {
  messages: [{ role: "user" as const, content: "Find me a kids bike under $30" }],
  cartId: "cart-1",
  saleName: "Maple Street Yard Sale",
};

describe("shopping assistant", () => {
  it("stops after at most 8 steps when the model keeps calling tools", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => toolCallResult("search_items", { query: "bike" }),
    });
    const repo = fakeRepo();
    const { toolCalls, result } = await generateShoppingReply(
      { ...baseInput, repo },
      { model },
    );
    expect(SHOPPING_MAX_STEPS).toBe(8);
    expect(model.doGenerateCalls).toHaveLength(8);
    expect(result.steps).toHaveLength(8);
    expect(toolCalls).toHaveLength(8);
    expect(toolCalls[0]).toEqual({ step: 1, toolName: "search_items", input: { query: "bike" } });
    expect(repo.searchItems).toHaveBeenCalledTimes(8);
  });

  it("registers only shopping tools, none that pay", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult("Hi!") });
    await generateShoppingReply({ ...baseInput, repo: fakeRepo() }, { model });
    const call = model.doGenerateCalls[0];
    const names = (call.tools ?? []).map((t) => ("name" in t ? t.name : ""));
    expect(names.sort()).toEqual(["get_cart", "hold_item", "release_hold", "search_items"]);
    for (const name of names) {
      expect(name).not.toMatch(/pay|checkout|capture|order|refund|purchase|buy/i);
    }
  });

  it("sends the shopping system prompt", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => textResult("Hi!") });
    await generateShoppingReply({ ...baseInput, repo: fakeRepo() }, { model });
    const prompt = model.doGenerateCalls[0].prompt;
    expect(prompt[0].role).toBe("system");
    expect(JSON.stringify(prompt[0])).toContain("Maple Street Yard Sale");
  });

  it("runs a hold then answers, summarizing tool calls", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCallResult("hold_item", { itemId: "item-1" }),
        textResult(`Held for 15 minutes. Pay at ${CART_PATH}.`),
      ],
    });
    const repo = fakeRepo();
    const reply = await generateShoppingReply({ ...baseInput, repo }, { model });
    expect(repo.holdItem).toHaveBeenCalledWith("item-1", "cart-1");
    expect(reply.text).toContain(CART_PATH);
    expect(reply.toolCalls).toEqual([
      { step: 1, toolName: "hold_item", input: { itemId: "item-1" } },
    ]);
  });

  it("streams and resolves the tool-call summary once consumed", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        call += 1;
        if (call === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start" as const, warnings: [] },
                {
                  type: "tool-call" as const,
                  toolCallId: "c1",
                  toolName: "get_cart",
                  input: "{}",
                },
                {
                  type: "finish" as const,
                  finishReason: { unified: "tool-calls" as const, raw: undefined },
                  logprobs: undefined,
                  usage: mockUsage,
                },
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              { type: "text-start" as const, id: "t1" },
              { type: "text-delta" as const, id: "t1", delta: "Your cart is empty." },
              { type: "text-end" as const, id: "t1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage: mockUsage,
              },
            ],
          }),
        };
      },
    });
    const repo = fakeRepo();
    const { result, toolCalls } = runShoppingAssistant({ ...baseInput, repo }, { model });
    let text = "";
    for await (const delta of result.textStream) text += delta;
    expect(text).toBe("Your cart is empty.");
    await expect(toolCalls).resolves.toEqual([{ step: 1, toolName: "get_cart", input: {} }]);
    expect(repo.getCart).toHaveBeenCalledWith("cart-1");
  });

  it("prompt forbids claiming payment and points to the cart", () => {
    const prompt = shoppingSystemPrompt("Maple Street Yard Sale");
    expect(prompt).toContain("15 minutes");
    expect(prompt).toContain("never say or imply that you have paid");
    expect(prompt).toContain(CART_PATH);
    expect(prompt).toContain("PayPal");
    expect(prompt).toContain("no more than they asked for");
  });
});
