import type { RummageClient } from "@/lib/supabase/server";

import { queryFailed, RepoError } from "./errors";

/**
 * The buyer's live cart for a sale. The schema allows one live ('open' or 'checkout')
 * cart per buyer per sale (`carts_one_live_per_buyer_sale`); a buyer creates it with a
 * plain insert of `sale_id` (`buyer_user_id` defaults to auth.uid(), and the insert
 * policy requires the sale to be open).
 */
export type LiveCart = { status: "open" | "checkout"; cartId: string };

async function findLiveCart(
  db: RummageClient,
  saleId: string,
  userId: string,
): Promise<LiveCart | null> {
  const { data, error } = await db
    .from("carts")
    .select("id, status")
    .eq("sale_id", saleId)
    .eq("buyer_user_id", userId)
    .in("status", ["open", "checkout"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw queryFailed("findLiveCart", error);
  if (!data || (data.status !== "open" && data.status !== "checkout")) return null;
  return { status: data.status, cartId: data.id };
}

/** Returns the buyer's live cart in the sale, creating an open one when there is none. */
export async function ensureLiveCart(
  db: RummageClient,
  saleId: string,
  userId: string,
): Promise<LiveCart> {
  const existing = await findLiveCart(db, saleId, userId);
  if (existing) return existing;

  const { data, error } = await db
    .from("carts")
    .insert({ sale_id: saleId, buyer_user_id: userId })
    .select("id")
    .single();
  if (error) {
    // 23505: a concurrent request created the live cart first.
    if (error.code === "23505") {
      const raced = await findLiveCart(db, saleId, userId);
      if (raced) return raced;
    }
    // 42501: the insert policy refused (sale not open).
    if (error.code === "42501") {
      throw new RepoError("cart_not_allowed", "ensureLiveCart", error.message, error.code);
    }
    throw queryFailed("ensureLiveCart", error);
  }
  return { status: "open", cartId: data.id };
}
