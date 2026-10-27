import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { jsonSchema, tool, zodSchema, type JSONSchema7, type Tool } from "ai";
import {
  ORGANIZER_PAYPAL_ACTIONS,
  ORGANIZER_PAYPAL_TOOL_NAMES,
} from "./paypal-readonly";

export { ORGANIZER_PAYPAL_ACTIONS, ORGANIZER_PAYPAL_TOOL_NAMES };

/**
 * Lane D spike: PayPal Agent Toolkit 1.11.0 inside AI SDK 7.
 *
 * The toolkit's `ai-sdk` entry builds its tools with its own nested `ai@4`
 * (`tool({ description, parameters, execute })`, parameters are zod 3
 * schemas from its nested `zod@3`). AI SDK 7 tools use `inputSchema` and a
 * different execute-options shape, so they cannot be passed to
 * `generateText`/`streamText` as they are. `wrapToolkitTools` re-wraps each one
 * into an ai@7 `tool()`.
 *
 * Boundary casts (deliberate, and the only ones in lane D):
 * - zod 3 parameters are handed to ai@7 `zodSchema()` through
 *   `as unknown as Zod3Like`: ai@7's provider-utils detects zod 3 at runtime
 *   (no `_zod` key) and converts it, but the nested zod 3.25.76 types are not
 *   the same declarations as the root zod's `zod/v3` types.
 * - the legacy `execute` receives `messages: []`: ai@4 expects `CoreMessage[]`,
 *   the toolkit never reads it, and ai@7 `ModelMessage`s are not that type.
 */

/** The structural slice of an ai@4 tool the wrapper relies on. */
export interface LegacyToolkitTool {
  description?: string;
  parameters: unknown;
  execute?(
    args: never,
    options: { toolCallId: string; messages: never[]; abortSignal?: AbortSignal },
  ): PromiseLike<unknown>;
}

export type LegacyToolkitTools = Record<string, LegacyToolkitTool>;

type Zod3Like = Parameters<typeof zodSchema>[0];

interface LegacyJsonSchema {
  jsonSchema: JSONSchema7;
  validate?: (
    value: unknown,
  ) =>
    | { success: true; value: unknown }
    | { success: false; error: Error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isZod3Schema(value: unknown): boolean {
  return (
    isRecord(value) &&
    !("_zod" in value) &&
    "_def" in value &&
    typeof value.safeParseAsync === "function"
  );
}

function isLegacyJsonSchema(value: unknown): value is LegacyJsonSchema {
  return isRecord(value) && isRecord(value.jsonSchema);
}

/** Converts a legacy tool's `parameters` into an ai@7 `inputSchema`. */
export function toInputSchema(parameters: unknown) {
  if (isZod3Schema(parameters)) {
    return zodSchema(parameters as unknown as Zod3Like);
  }
  if (isLegacyJsonSchema(parameters)) {
    const { validate } = parameters;
    return jsonSchema<unknown>(
      parameters.jsonSchema,
      validate ? { validate: (value) => validate(value) } : {},
    );
  }
  throw new TypeError(
    "Unsupported toolkit tool parameters: expected a zod 3 schema or an ai@4 jsonSchema()",
  );
}

/** Re-wraps every legacy (ai@4) toolkit tool into an AI SDK 7 `tool()`. */
export function wrapToolkitTools(toolkitTools: LegacyToolkitTools): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {};
  for (const [name, legacy] of Object.entries(toolkitTools)) {
    const execute = legacy.execute;
    if (!execute) {
      throw new TypeError(`Toolkit tool "${name}" has no execute function`);
    }
    wrapped[name] = tool({
      description: legacy.description,
      inputSchema: toInputSchema(legacy.parameters),
      execute: async (input: unknown, options) =>
        execute.call(legacy, input as never, {
          toolCallId: options.toolCallId,
          messages: [],
          abortSignal: options.abortSignal,
        }),
    });
  }
  return wrapped;
}

export interface PayPalOrganizerToolsOptions {
  clientId: string;
  clientSecret: string;
}

/**
 * Builds the read-only PayPal tool set for organizer Q&A, always against the
 * sandbox. The toolkit defaults to LIVE (`context.sandbox ?? false`), so
 * `sandbox: true` is forced here and cannot be overridden by the caller.
 * Construction makes no network call; the OAuth token is fetched on the first
 * tool execution.
 */
export function makePayPalOrganizerTools(
  options: PayPalOrganizerToolsOptions,
): Record<string, Tool> {
  const toolkit = new PayPalAgentToolkit({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    configuration: {
      actions: {
        transactions: { ...ORGANIZER_PAYPAL_ACTIONS.transactions },
        orders: { ...ORGANIZER_PAYPAL_ACTIONS.orders },
        payments: { ...ORGANIZER_PAYPAL_ACTIONS.payments },
      },
      context: { sandbox: true },
    },
  });
  const wrapped = wrapToolkitTools(toolkit.getTools());
  const unexpected = Object.keys(wrapped).filter(
    (name) => !(ORGANIZER_PAYPAL_TOOL_NAMES as readonly string[]).includes(name),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `PayPal toolkit returned tools outside the read-only set: ${unexpected.join(", ")}`,
    );
  }
  return wrapped;
}
