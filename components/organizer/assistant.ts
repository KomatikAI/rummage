import { z } from "zod";

/**
 * The organizer assistant chat: request bodies for POST /api/assistant/organizer, the
 * response schema, and the plain words shown for tool calls and errors. The route
 * answers one question at a time (request/response, not streaming).
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Captions for the tools the assistant used for this answer. */
  toolCaptions?: string[];
  /** The tool names, kept for the PayPal data card. */
  toolNames?: string[];
  /** Whether read-only PayPal sandbox lookups were available for this answer. */
  paypalData?: boolean;
}

/** How many earlier messages travel with each question. */
export const HISTORY_LIMIT = 20;
export const QUESTION_MAX_LENGTH = 2000;

export interface AssistantRequestBody {
  saleId: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

export function toRequestBody(saleId: string, messages: ChatMessage[]): AssistantRequestBody {
  return {
    saleId,
    messages: messages.slice(-HISTORY_LIMIT).map((message) => ({ role: message.role, content: message.text })),
  };
}

export const assistantResponseSchema = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ step: z.number(), toolName: z.string() })),
  paypalData: z.boolean(),
});

export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

const TOOL_CAPTIONS: Record<string, string> = {
  sale_summary: "Checked the sale summary",
  household_statuses: "Looked at each household",
  fundraiser_total: "Checked the fundraiser total",
  list_transactions: "Read PayPal sandbox transactions",
  get_order: "Looked up a PayPal order",
  get_refund: "Looked up a PayPal refund",
};

/** PayPal sandbox lookups the assistant can make (read-only). */
export const PAYPAL_TOOL_NAMES = new Set(["list_transactions", "get_order", "get_refund"]);

export function toolCaption(toolName: string): string {
  return TOOL_CAPTIONS[toolName] ?? `Used ${toolName.replace(/_/g, " ")}`;
}

/** One caption per distinct tool, in the order first used. */
export function toolCaptions(toolCalls: AssistantResponse["toolCalls"]): string[] {
  const seen = new Set<string>();
  const captions: string[] = [];
  for (const call of toolCalls) {
    if (seen.has(call.toolName)) continue;
    seen.add(call.toolName);
    captions.push(toolCaption(call.toolName));
  }
  return captions;
}

/** Turns a 200 response into the assistant's chat message, or null when the shape is wrong. */
export function toAssistantMessage(id: string, json: unknown): ChatMessage | null {
  const parsed = assistantResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const { text, toolCalls, paypalData } = parsed.data;
  return {
    id,
    role: "assistant",
    text: text.trim() || "I could not find an answer to that. Try asking another way.",
    toolCaptions: toolCaptions(toolCalls),
    toolNames: toolCalls.map((call) => call.toolName),
    paypalData,
  };
}

export interface KeyValueRow {
  label: string;
  value: string;
}

/** The small PayPal data card under an answer. */
export function paypalDataRows(message: Pick<ChatMessage, "paypalData" | "toolNames">): KeyValueRow[] {
  const lookups = (message.toolNames ?? []).filter((name) => PAYPAL_TOOL_NAMES.has(name)).length;
  return [
    { label: "PayPal sandbox data", value: message.paypalData ? "Available" : "Not set up" },
    { label: "PayPal lookups in this answer", value: String(lookups) },
    { label: "Access", value: "Read only" },
  ];
}

const ASSISTANT_ERRORS: Record<string, string> = {
  sign_in_required: "Your session has ended. Sign in again to keep asking.",
  organizer_only: "Only this sale's organizer can ask about it here.",
  question_required: "Type a question first.",
  question_too_long: "That question is a bit long. Try a shorter one.",
  body_too_large: "This chat has grown too long. Reload the page to start a new one.",
};

/** A plain sentence for an error code from the assistant route. */
export function assistantErrorMessage(code: string | undefined): string {
  return (code && ASSISTANT_ERRORS[code]) || "The assistant could not answer just now. Try again in a moment.";
}

/** Example questions shown before the first message. */
export const STARTER_QUESTIONS = [
  "How is the sale going so far?",
  "Which households still need to link PayPal?",
  "How close are we to the fundraiser goal?",
] as const;
