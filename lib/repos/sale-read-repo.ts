import { z } from "zod";

import type {
  FundraiserTotal,
  HouseholdStatus,
  SaleReadRepo,
  SaleSummary,
} from "@/lib/ai/organizer-tools";
import type { RummageClient } from "@/lib/supabase/server";
import { PAYPAL_STATUSES, type SaleStatus } from "@/lib/supabase/types";

import { queryFailed, RepoError } from "./errors";

/**
 * Read-only `SaleReadRepo` over Supabase, running as the signed-in organizer.
 *
 * Money and item counts come from `organizer_sale_summary(p_sale)` (organizers have no
 * row access to purchase_units); the sale's name, dates and status come from `sales`, and
 * household owner links from `households`, both of which RLS lets the organizer read.
 * The summary is fetched once per repo instance (one instance per request), because
 * the assistant often calls all three tools in one answer. Nothing here writes.
 */

const count = z.coerce.number().int().nonnegative();
const money = z.coerce.number();

const householdSummarySchema = z.object({
  household_id: z.string(),
  label: z.string(),
  paypal_status: z.enum(PAYPAL_STATUSES),
  paused: z.boolean(),
  items_listed: count,
  items_held: count,
  items_sold: count,
  items_collected: count,
  items_cash_sold: count,
  cash_total: money,
  gross: money,
});

/** organizer_sale_summary's jsonb, validated at the boundary. */
export const organizerSummarySchema = z.object({
  sale_id: z.string(),
  households: count,
  households_linked: count,
  items_listed: count,
  items_held: count,
  items_sold: count,
  items_collected: count,
  items_cash_sold: count,
  gross_total: money,
  cash_total: money,
  fundraiser_total: money,
  fundraiser_goal: money.nullable(),
  paid_order_count: count,
  per_household: z.array(householdSummarySchema),
});

export type ParsedOrganizerSummary = z.infer<typeof organizerSummarySchema>;

/** draft -> draft, open -> live, closed -> ended. The schema has no "scheduled" state. */
export function toSummaryStatus(status: SaleStatus): SaleSummary["status"] {
  switch (status) {
    case "draft":
      return "draft";
    case "open":
      return "live";
    case "closed":
      return "ended";
  }
}

/** sale_date + time of day as a local ISO-like string; the date alone when no time is set. */
export function saleDateTime(saleDate: string | null, time: string | null): string | null {
  if (!saleDate) return null;
  return time ? `${saleDate}T${time}` : saleDate;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

type SaleRecord = {
  id: string;
  name: string;
  status: SaleStatus;
  sale_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

export class SupabaseSaleReadRepo implements SaleReadRepo {
  private readonly db: RummageClient;
  private readonly summaries = new Map<string, Promise<ParsedOrganizerSummary>>();

  constructor(db: RummageClient) {
    this.db = db;
  }

  async saleSummary(saleId: string): Promise<SaleSummary> {
    const [summary, sale] = await Promise.all([this.summary(saleId), this.sale(saleId)]);
    const itemsSold = summary.items_sold + summary.items_cash_sold;
    return {
      saleId,
      name: sale.name,
      status: toSummaryStatus(sale.status),
      startsAt: saleDateTime(sale.sale_date, sale.starts_at),
      endsAt: sale.ends_at ? saleDateTime(sale.sale_date, sale.ends_at) : null,
      householdCount: summary.households,
      itemCount: summary.items_listed + summary.items_held + itemsSold,
      itemsAvailable: summary.items_listed,
      itemsHeld: summary.items_held,
      itemsSold,
      // PayPal captures (completed, unrefunded) plus cash sales sellers recorded.
      grossSales: roundCents(summary.gross_total + summary.cash_total),
    };
  }

  async householdStatuses(saleId: string): Promise<HouseholdStatus[]> {
    const summary = await this.summary(saleId);
    const { data, error } = await this.db
      .from("households")
      .select("id, owner_user_id")
      .eq("sale_id", saleId);
    if (error) throw queryFailed("householdStatuses", error);
    const owned = new Map((data ?? []).map((row) => [row.id, row.owner_user_id !== null]));

    return summary.per_household.map((household) => {
      const itemsSold = household.items_sold + household.items_cash_sold;
      const onboarding: HouseholdStatus["onboarding"] =
        household.paypal_status === "ready"
          ? "ready"
          : owned.get(household.household_id)
            ? "in_progress"
            : "invited";
      return {
        householdId: household.household_id,
        name: household.label,
        onboarding,
        paypalConnected: household.paypal_status === "ready",
        itemCount: household.items_listed + household.items_held + itemsSold,
        itemsSold,
        sales: roundCents(household.gross + household.cash_total),
      };
    });
  }

  async fundraiserTotal(saleId: string): Promise<FundraiserTotal> {
    const summary = await this.summary(saleId);
    return {
      saleId,
      currency: "USD",
      raised: roundCents(summary.fundraiser_total),
      goal: summary.fundraiser_goal === null ? null : roundCents(summary.fundraiser_goal),
      // Organizers cannot read carts; the summary counts paid and partially paid ones.
      paidOrderCount: summary.paid_order_count,
    };
  }

  private summary(saleId: string): Promise<ParsedOrganizerSummary> {
    let pending = this.summaries.get(saleId);
    if (!pending) {
      pending = this.loadSummary(saleId);
      // A failed read is not cached, so a later tool call can retry.
      pending.catch(() => this.summaries.delete(saleId));
      this.summaries.set(saleId, pending);
    }
    return pending;
  }

  private async loadSummary(saleId: string): Promise<ParsedOrganizerSummary> {
    const { data, error } = await this.db.rpc("organizer_sale_summary", { p_sale: saleId });
    if (error) {
      // 42501: "only the organizer can read this sale summary"; 22P02: not a uuid.
      if (error.code === "42501" || error.code === "22P02") {
        throw new RepoError("not_organizer", "saleSummary", error.message, error.code);
      }
      throw queryFailed("saleSummary", error);
    }
    const parsed = organizerSummarySchema.safeParse(data);
    if (!parsed.success) {
      throw new RepoError(
        "invalid_summary",
        "saleSummary",
        "organizer_sale_summary returned an unexpected shape",
      );
    }
    return parsed.data;
  }

  private async sale(saleId: string): Promise<SaleRecord> {
    const { data, error } = await this.db
      .from("sales")
      .select("id, name, status, sale_date, starts_at, ends_at")
      .eq("id", saleId)
      .maybeSingle();
    if (error) throw queryFailed("saleSummary", error);
    if (!data) throw new RepoError("sale_not_found", "saleSummary", "no such sale for this user");
    return data;
  }
}
