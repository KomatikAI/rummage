"use server";

import { releaseResultMessage, type ActionResult } from "@/components/buyer/hold-messages";
import { currentUserId, isUuid } from "@/lib/repos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Removes one held item from the buyer's open cart, so someone else can buy it. */
export async function releaseHoldAction(input: { cartId: string; itemId: string }): Promise<ActionResult> {
  if (!isUuid(input.cartId) || !isUuid(input.itemId)) {
    return { ok: false, message: "That item could not be found. Refresh the page and try again." };
  }

  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return { ok: false, message: "Sign in again to change your cart." };

  const { data, error } = await db.rpc("release_hold", { p_item: input.itemId, p_cart: input.cartId });
  if (error || !data) {
    return { ok: false, message: "We could not change your cart just now. Wait a moment and try again." };
  }
  return releaseResultMessage(data);
}
