import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, isStepCount, tool, type LanguageModel, type Tool } from "ai";
import { z } from "zod";
import { env } from "@/lib/env";
import { ORGANIZER_PAYPAL_TOOL_NAMES } from "./paypal-readonly";
import {
  anthropicCallOptions,
  ASSISTANT_MODEL,
  summarizeToolCalls,
  type AssistantDeps,
} from "./shopping-assistant";

/**
 * Organizer Q&A: read-only answers about one sale from the sale records and,
 * when supplied, from PayPal transaction data. Every tool here reads; there is
 * no tool that changes a sale, a household, an item or a payment.
 */

export const ORGANIZER_MAX_STEPS = 6;

export interface SaleSummary {
  saleId: string;
  name: string;
  status: "draft" | "scheduled" | "live" | "ended";
  startsAt: string | null;
  endsAt: string | null;
  householdCount: number;
  itemCount: number;
  itemsAvailable: number;
  itemsHeld: number;
  itemsSold: number;
  /** Gross item sales in US dollars. */
  grossSales: number;
}

export interface HouseholdStatus {
  householdId: string;
  name: string;
  onboarding: "invited" | "in_progress" | "ready";
  paypalConnected: boolean;
  itemCount: number;
  itemsSold: number;
  /** Item sales in US dollars. */
  sales: number;
}

export interface FundraiserTotal {
  saleId: string;
  currency: "USD";
  /** Amount raised for the fundraiser so far, in US dollars. */
  raised: number;
  goal: number | null;
  paidOrderCount: number;
}

/** Read-only data access for organizer questions. Implemented elsewhere. */
export interface SaleReadRepo {
  saleSummary(saleId: string): Promise<SaleSummary>;
  householdStatuses(saleId: string): Promise<HouseholdStatus[]>;
  fundraiserTotal(saleId: string): Promise<FundraiserTotal>;
}

const noInput = z.object({});

/** The three sale-record tools, bound to one sale (the model never picks the sale). */
export function makeOrganizerTools(repo: SaleReadRepo, options: { saleId: string }) {
  const { saleId } = options;
  return {
    sale_summary: tool({
      description:
        "Read the sale's status, dates, household count and item counts (available, held, sold) and gross sales.",
      inputSchema: noInput,
      execute: async () => repo.saleSummary(saleId),
    }),
    household_statuses: tool({
      description:
        "Read every household in the sale: onboarding state, whether PayPal is connected, items listed, items sold and sales.",
      inputSchema: noInput,
      execute: async () => repo.householdStatuses(saleId),
    }),
    fundraiser_total: tool({
      description:
        "Read how much the sale has raised for its fundraiser, the goal if one is set, and the number of paid orders.",
      inputSchema: noInput,
      execute: async () => repo.fundraiserTotal(saleId),
    }),
  };
}

export const ORGANIZER_TOOL_NAMES = [
  "sale_summary",
  "household_statuses",
  "fundraiser_total",
] as const;

export interface OrganizerAssistantInput {
  question: string;
  repo: SaleReadRepo;
  saleId: string;
  /** Read-only PayPal tools from `makePayPalOrganizerTools`. Optional. */
  paypalTools?: Record<string, Tool>;
}

export function organizerSystemPrompt(hasPayPalTools: boolean): string {
  const sources = hasPayPalTools
    ? "the sale records (sale_summary, household_statuses, fundraiser_total) and PayPal sandbox transaction data (list_transactions, get_order, get_refund)"
    : "the sale records (sale_summary, household_statuses, fundraiser_total)";
  return `You answer a yard-sale organizer's questions about their sale.

- Answer only from ${sources}. Call the tools you need; do not guess numbers.
- You can read, not change. You cannot edit listings, contact households, move money, refund, capture or cancel anything. If asked to, say what the organizer can do themselves instead.
- When the sale records and PayPal data disagree, report both and say which source each figure came from.
- Amounts are US dollars. Keep answers short and plain.${
    hasPayPalTools
      ? ""
      : "\n- PayPal transaction data is not available in this conversation; say so if the question needs it."
  }`;
}

function assertReadOnlyPayPalTools(paypalTools: Record<string, Tool>): void {
  const allowed = ORGANIZER_PAYPAL_TOOL_NAMES as readonly string[];
  const rejected = Object.keys(paypalTools).filter((name) => !allowed.includes(name));
  if (rejected.length > 0) {
    throw new Error(
      `Organizer assistant only accepts read-only PayPal tools; rejected: ${rejected.join(", ")}`,
    );
  }
}

function resolveModel(deps: AssistantDeps): LanguageModel {
  if (deps.model) return deps.model;
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic(ASSISTANT_MODEL);
}

/** Answers one organizer question. Non-streaming: answers are short. */
export async function runOrganizerAssistant(
  input: OrganizerAssistantInput,
  deps: AssistantDeps = {},
) {
  const paypalTools = input.paypalTools ?? {};
  assertReadOnlyPayPalTools(paypalTools);
  const tools: Record<string, Tool> = {
    ...paypalTools,
    ...makeOrganizerTools(input.repo, { saleId: input.saleId }),
  };
  const result = await generateText({
    model: resolveModel(deps),
    instructions: organizerSystemPrompt(Object.keys(paypalTools).length > 0),
    prompt: input.question,
    tools,
    stopWhen: isStepCount(ORGANIZER_MAX_STEPS),
    providerOptions: { anthropic: anthropicCallOptions },
  });
  return {
    result,
    text: result.text,
    toolCalls: summarizeToolCalls(result.steps),
  };
}
