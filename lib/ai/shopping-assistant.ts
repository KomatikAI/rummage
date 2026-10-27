import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import {
  generateText,
  isStepCount,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StepResult,
  type ToolSet,
} from "ai";
import { env } from "@/lib/env";
import {
  HOLD_MINUTES,
  makeShoppingTools,
  type ItemsRepo,
} from "./shopping-tools";

/**
 * Buyer shopping assistant. It searches items across the sale's households,
 * holds what the buyer asks for, and hands the buyer to /buyer/cart. It never
 * pays: no payment tool is registered, and the prompt says so.
 */

export const ASSISTANT_MODEL = "claude-opus-5-5";
/** Upper bound on model steps (each step is one model call, plus its tool calls). */
export const SHOPPING_MAX_STEPS = 8;
export const CART_PATH = "/buyer/cart";

export const anthropicCallOptions = {
  effort: "medium",
  fallbacks: "default",
} satisfies AnthropicLanguageModelOptions;

export interface ShoppingAssistantInput {
  messages: ModelMessage[];
  repo: ItemsRepo;
  cartId: string;
  saleName: string;
}

export interface AssistantDeps {
  /** Override the model; tests pass a `MockLanguageModelV4`. */
  model?: LanguageModel;
}

export interface ToolCallSummary {
  step: number;
  toolName: string;
  input: unknown;
}

export function shoppingSystemPrompt(saleName: string): string {
  return `You are the shopping assistant for "${saleName}", a community yard sale where many households sell their own items.

What you do:
- Help the buyer find items across every household in the sale with search_items. Mention the household and price of what you find.
- Hold items only when the buyer asks you to, and hold no more than they asked for. If an item is already held or sold, say so and offer alternatives.
- Holds last ${HOLD_MINUTES} minutes. Tell the buyer that when you place one.
- Use get_cart to check what is held before summarizing, and release_hold when the buyer changes their mind.

What you never do:
- You cannot pay, check out, or complete a purchase, and you must never say or imply that you have paid, that an order is placed, or that an item is bought. Holding an item is not buying it.
- Do not invent items, prices or availability; only report what the tools return.

How you finish:
- When the buyer is ready, point them to ${CART_PATH}, where they review their held items and confirm payment with PayPal themselves.`;
}

function resolveModel(deps: AssistantDeps): LanguageModel {
  if (deps.model) return deps.model;
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic(ASSISTANT_MODEL);
}

/** Flattens the tool calls of every step into a plain summary list. */
export function summarizeToolCalls<TOOLS extends ToolSet>(
  steps: ReadonlyArray<StepResult<TOOLS>>,
): ToolCallSummary[] {
  return steps.flatMap((step, index) =>
    step.toolCalls.map((call) => ({
      step: index + 1,
      toolName: call.toolName,
      input: call.input,
    })),
  );
}

function buildCall(input: ShoppingAssistantInput, deps: AssistantDeps) {
  return {
    model: resolveModel(deps),
    instructions: shoppingSystemPrompt(input.saleName),
    messages: input.messages,
    tools: makeShoppingTools(input.repo, { cartId: input.cartId }),
    stopWhen: isStepCount(SHOPPING_MAX_STEPS),
    providerOptions: { anthropic: anthropicCallOptions },
  };
}

/**
 * Streaming entry point for the route handler. `toolCalls` resolves once the
 * stream has been consumed (for example by `toUIMessageStreamResponse()`).
 */
export function runShoppingAssistant(
  input: ShoppingAssistantInput,
  deps: AssistantDeps = {},
) {
  const result = streamText(buildCall(input, deps));
  const toolCalls: Promise<ToolCallSummary[]> = Promise.resolve(result.steps).then(
    (steps) => summarizeToolCalls(steps),
  );
  return { result, toolCalls };
}

/** Non-streaming variant with the same tools, prompt and stop condition. */
export async function generateShoppingReply(
  input: ShoppingAssistantInput,
  deps: AssistantDeps = {},
) {
  const result = await generateText(buildCall(input, deps));
  return {
    result,
    text: result.text,
    toolCalls: summarizeToolCalls(result.steps),
  };
}
