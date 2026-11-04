import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type ModelMessage,
} from "ai";

import { env } from "@/lib/env";

/**
 * Every model call goes through OpenRouter (https://openrouter.ai), never to a vendor
 * API directly. One key, `OPENROUTER_API_KEY`, covers all of them.
 *
 * Models are OpenAI's GPT-6 family. Luna is the cheap tier (about $0.10 per million
 * input tokens), Terra the mid tier (about $1), Sol the expensive one (about $2) and
 * is not used. Pricing and the prohibited-item screen take a photo and decide money
 * or safety, so they get Terra; the camera scan and the chat assistants run many
 * times per visit, so they get Luna. All four take images, structured output, tools
 * and a reasoning effort.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const PRICING_MODEL = "openai/gpt-6.1-terra";
export const SCREEN_MODEL = "openai/gpt-6.1-terra";
export const SCAN_MODEL = "openai/gpt-6-luna";
export const ASSISTANT_MODEL = "openai/gpt-6-luna";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** `providerOptions` that set the reasoning effort for an OpenRouter call. */
export function reasoningOptions(effort: ReasoningEffort) {
  return { openrouter: { reasoning: { effort } } };
}

let provider: ReturnType<typeof createOpenRouter> | undefined;

/** A model handle for `modelId`, built from `OPENROUTER_API_KEY` on first use. */
export function openRouterModel(modelId: string): LanguageModel {
  provider ??= createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    headers: { "X-Title": "Rummage" },
  });
  return provider(modelId);
}

/** Drops the cached provider. For tests only. */
export function resetOpenRouterProvider(): void {
  provider = undefined;
}

/** One structured-output request: a system prompt, a user turn and the JSON schema the reply must follow. */
export interface StructuredCall {
  system: string;
  messages: ModelMessage[];
  maxOutputTokens: number;
  effort: ReasoningEffort;
  /** Name sent with the schema (`response_format.json_schema.name`). */
  schemaName: string;
  /** JSON schema sent as the response format. */
  schema: Record<string, unknown>;
}

export type StructuredFailureCode =
  | "refusal"
  | "max_tokens"
  | "no_output"
  | "invalid_json"
  | "invalid_output";

export type StructuredResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: StructuredFailureCode;
      message: string;
      /** The unified finish reason the SDK reported, when there was one. */
      stopReason: string | null;
      /** Parser or validator detail, e.g. zod issues. */
      details: unknown;
    };

/** The shape of `zod`'s `safeParse` result, without tying callers to one zod generic. */
export type SafeParser<T> = (
  raw: unknown,
) => { success: true; data: T } | { success: false; error: { issues: unknown } };

function failure<T>(
  code: StructuredFailureCode,
  message: string,
  stopReason: string | null = null,
  details: unknown = null,
): StructuredResult<T> {
  return { ok: false, code, message, stopReason, details };
}

/**
 * Runs one structured-output call and validates the reply with `parse`. Transport and
 * API errors propagate; an unusable reply comes back as `{ ok: false, code }` so callers
 * keep their own error types. A reply cut off at `maxOutputTokens` fails even when the
 * JSON happens to be complete, as before the OpenRouter switch.
 */
export async function generateStructured<T>(
  model: LanguageModel,
  call: StructuredCall,
  parse: SafeParser<T>,
): Promise<StructuredResult<T>> {
  let result;
  try {
    result = await generateText({
      model,
      system: call.system,
      messages: call.messages,
      maxOutputTokens: call.maxOutputTokens,
      output: Output.object({ name: call.schemaName, schema: jsonSchema<unknown>(call.schema) }),
      providerOptions: reasoningOptions(call.effort),
    });
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      const reason = error.finishReason ?? null;
      if (reason === "length") return failure("max_tokens", "The reply was cut off at max tokens", reason);
      if (reason === "content-filter") return failure("refusal", "The model declined the request", reason);
      if (!error.text?.trim()) return failure("no_output", "The reply had no text", reason);
      return failure("invalid_json", "The reply was not valid JSON", reason, error.cause);
    }
    throw error;
  }

  const reason = result.finishReason;
  if (reason === "length") return failure("max_tokens", "The reply was cut off at max tokens", reason);
  if (reason === "content-filter") return failure("refusal", "The model declined the request", reason);

  let raw: unknown;
  try {
    raw = result.output;
  } catch (error) {
    if (NoOutputGeneratedError.isInstance(error)) {
      return failure("no_output", "The reply had no structured output", reason);
    }
    throw error;
  }

  const parsed = parse(raw);
  if (!parsed.success) {
    return failure("invalid_output", "The reply did not match the schema", reason, parsed.error.issues);
  }
  return { ok: true, value: parsed.data };
}
