import { z } from "zod";

import { decideCancel } from "@/lib/checkout/cancel";
import { databaseError, jsonError, readJsonBody, unauthorized } from "@/lib/checkout/http";
import { getSignedInUserId } from "@/lib/checkout/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({ cartId: z.uuid() });

const OPEN = { status: "open" } as const;

/**
 * POST { cartId } -> { status: "open" }
 * Undoes a checkout the buyer closed before paying: deletes the cart's pending
 * purchase units, forgets the PayPal order and puts the cart back to `open`, so its
 * lines can be edited again. Holds stay. The PayPal order itself is left to expire;
 * nothing can capture it once no cart names it.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if (!body.ok) return body.response;
  const { cartId } = body.data;

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const cart = await admin
    .from("carts")
    .select("id, buyer_user_id, status, paypal_order_id")
    .eq("id", cartId)
    .maybeSingle();
  if (cart.error) return databaseError("load cart", cart.error);
  if (!cart.data) return jsonError(404, "cart_not_found", "No such cart.");
  if (cart.data.buyer_user_id !== userId) return jsonError(403, "forbidden", "This cart belongs to someone else.");

  const units = await admin.from("purchase_units").select("capture_id, capture_status").eq("cart_id", cartId);
  if (units.error) return databaseError("load purchase units", units.error);

  const decision = decideCancel({
    status: cart.data.status,
    paypalOrderId: cart.data.paypal_order_id,
    units: units.data ?? [],
  });
  switch (decision.kind) {
    case "already_open":
      return Response.json(OPEN);
    case "not_in_checkout":
      return jsonError(409, "cart_not_in_checkout", `The cart is ${cart.data.status} and has no checkout to cancel.`);
    case "capture_started":
      return jsonError(409, "capture_started", "A payment for this cart has started. Call capture to finish it.", {
        orderId: cart.data.paypal_order_id,
      });
    case "cancel":
      break;
  }

  // Only rows PayPal has reported nothing for: a capture recorded since the read above
  // keeps its row.
  const deleted = await admin.from("purchase_units").delete().eq("cart_id", cartId).is("capture_status", null);
  if (deleted.error) return databaseError("delete purchase units", deleted.error);

  const reopened = await admin
    .from("carts")
    .update({ status: "open", paypal_order_id: null })
    .eq("id", cartId)
    .eq("status", "checkout")
    .select("id");
  if (reopened.error) return databaseError("reopen cart", reopened.error);
  if (!reopened.data || reopened.data.length === 0) {
    // Something else moved the cart since the read (a capture, the expiry sweep).
    return jsonError(409, "cart_not_in_checkout", "The cart left checkout while it was being cancelled.");
  }

  return Response.json(OPEN);
}
