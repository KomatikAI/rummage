"use server";

import { holdResultMessage, type ActionResult } from "@/components/buyer/hold-messages";
import { currentUserId, ensureLiveCart, isUuid, RepoError } from "@/lib/repos";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { maxHouseholdsPerCart } from "@/lib/supabase/types";

const TRY_AGAIN: ActionResult = {
  ok: false,
  message: "We could not reach the sale just now. Wait a moment and try again.",
};

/**
 * Holds one item for 15 minutes in the buyer's live cart for the sale (an open cart is
 * created when there is none). Calls hold_item directly so every refusal keeps its own
 * reason (the items repo folds several of them into not_allowed).
 */
export async function holdItemAction(input: { saleId: string; itemId: string }): Promise<ActionResult> {
  if (!isUuid(input.saleId) || !isUuid(input.itemId)) {
    return { ok: false, message: "That item could not be found. Refresh the page and try again." };
  }

  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return { ok: false, message: "Sign in to hold items." };

  const sale = await db
    .from("public_sales")
    .select("id, status, fundraiser_name")
    .eq("id", input.saleId)
    .maybeSingle();
  if (sale.error) return TRY_AGAIN;
  if (!sale.data) return { ok: false, message: "This sale could not be found." };
  if (sale.data.status !== "open") {
    return { ok: false, message: "This sale is not taking holds right now." };
  }

  let cartId: string;
  try {
    const cart = await ensureLiveCart(db, input.saleId, userId);
    if (cart.status === "checkout") return holdResultMessage("cart_not_open", { maxHouseholds: 0 });
    cartId = cart.cartId;
  } catch (error) {
    if (error instanceof RepoError && error.code === "cart_not_allowed") {
      return { ok: false, message: "This sale is not taking holds right now." };
    }
    return TRY_AGAIN;
  }

  const { data, error } = await db.rpc("hold_item", { p_item: input.itemId, p_cart: cartId });
  if (error || !data) return TRY_AGAIN;
  return holdResultMessage(data, { maxHouseholds: maxHouseholdsPerCart(sale.data.fundraiser_name) });
}
