import "server-only";

import { notFound } from "next/navigation";

import { currentUserId, isUuid } from "@/lib/repos/auth";
import { organizerSummarySchema, type ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";

/**
 * Reads for the organizer's sale pages. The cookie (RLS) client proves the caller
 * organizes the sale (sales_select lets an organizer read their own row) and
 * organizer_sale_summary(p_sale) refuses anyone but the sale's organizer.
 *
 * invite_token and organizer_merchant_id have no client grant at all (a seller is a member
 * of the sale and must not read the token that admits sellers), so once the RLS read has
 * matched the sale to this organizer they are fetched with the admin client.
 */

const SALE_COLUMNS =
  "id, name, slug, description, sale_date, starts_at, ends_at, status, fundraiser_name, fundraiser_goal";
const PRIVATE_SALE_COLUMNS = "invite_token, organizer_merchant_id";

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
  const secret = await createSupabaseAdminClient().from("sales").select(PRIVATE_SALE_COLUMNS).eq("id", data.id).single();
  if (secret.error) throw new Error(`organizer: could not load sale (${secret.error.code ?? "unknown"})`);
  return { kind: "ok", db, userId, sale: { ...data, ...secret.data } };
}

export async function loadSummary(db: RummageClient, saleId: string): Promise<ParsedOrganizerSummary> {
  const { data, error } = await db.rpc("organizer_sale_summary", { p_sale: saleId });
  if (error) throw new Error(`organizer: could not load the sale summary (${error.code ?? "unknown"})`);
  return organizerSummarySchema.parse(data);
}
