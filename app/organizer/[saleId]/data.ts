import "server-only";

import { notFound } from "next/navigation";

import { currentUserId, isUuid } from "@/lib/repos/auth";
import { organizerSummarySchema, type ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";
import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";

/**
 * Reads for the organizer's sale pages, all through the cookie (RLS) client:
 * sales_select lets an organizer read their own sale row, and
 * organizer_sale_summary(p_sale) refuses anyone but the sale's organizer.
 */

const SALE_COLUMNS =
  "id, name, slug, description, sale_date, starts_at, ends_at, status, invite_token, fundraiser_name, fundraiser_goal, organizer_merchant_id";

export type OrganizerSaleContext =
  | { kind: "signed-out" }
  | { kind: "ok"; db: RummageClient; userId: string; sale: OrganizerSale };

export interface OrganizerSale {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sale_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: "draft" | "open" | "closed";
  invite_token: string;
  fundraiser_name: string | null;
  fundraiser_goal: number | string | null;
  organizer_merchant_id: string | null;
}

/** The caller's sale, or notFound() for a bad id or a sale they do not organize. */
export async function loadOrganizerSale(saleId: string): Promise<OrganizerSaleContext> {
  if (!isUuid(saleId)) notFound();
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return { kind: "signed-out" };
  const { data, error } = await db
    .from("sales")
    .select(SALE_COLUMNS)
    .eq("id", saleId)
    .eq("organizer_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`organizer: could not load sale (${error.code ?? "unknown"})`);
  if (!data) notFound();
  return { kind: "ok", db, userId, sale: data };
}

export async function loadSummary(db: RummageClient, saleId: string): Promise<ParsedOrganizerSummary> {
  const { data, error } = await db.rpc("organizer_sale_summary", { p_sale: saleId });
  if (error) throw new Error(`organizer: could not load the sale summary (${error.code ?? "unknown"})`);
  return organizerSummarySchema.parse(data);
}
