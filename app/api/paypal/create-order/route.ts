import { z } from "zod";

import { captureStarted } from "@/lib/checkout/cancel";
import {
  appBaseUrl,
  databaseError,
  jsonError,
  paypalErrorResponse,
  readJsonBody,
  unauthorized,
} from "@/lib/checkout/http";
import { buildCheckoutUnits, MAX_DONATION_CENTS } from "@/lib/checkout/order-units";
import { getSignedInUserId } from "@/lib/checkout/session";
import { env } from "@/lib/env";
import { createMultiSellerOrder, type CreatedOrder } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  cartId: z.uuid(),
  donationCents: z.number().int().min(0).max(MAX_DONATION_CENTS).optional(),
});

/** Puts a cart back to `open` after a failed checkout start (only if we moved it). */
async function reopenCart(admin: RummageClient, cartId: string): Promise<void> {
  const { error } = await admin
    .from("carts")
    .update({ status: "open", paypal_order_id: null })
    .eq("id", cartId)
    .eq("status", "checkout");
  if (error) console.error("[paypal/create-order] could not reopen cart", { code: error.code });
}

/**
 * POST { cartId, donationCents? } -> { orderId, approveUrl }
 * Creates one PayPal order with a purchase unit per household in the buyer's cart.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if (!body.ok) return body.response;
  const { cartId, donationCents = 0 } = body.data;

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const cart = await admin
    .from("carts")
    .select("id, buyer_user_id, sale_id, status")
    .eq("id", cartId)
    .maybeSingle();
  if (cart.error) return databaseError("load cart", cart.error);
  if (!cart.data) return jsonError(404, "cart_not_found", "No such cart.");
  if (cart.data.buyer_user_id !== userId) return jsonError(403, "forbidden", "This cart belongs to someone else.");
  if (cart.data.status === "checkout") {
    // A checkout the buyer closed before paying. Say so, so the cart page can offer
    // POST /api/paypal/cancel; never cancel it from here.
    const units = await admin.from("purchase_units").select("capture_id, capture_status").eq("cart_id", cartId);
    if (units.error) return databaseError("load purchase units", units.error);
    if (!(units.data ?? []).some(captureStarted)) {
      return jsonError(409, "cart_in_checkout", "The cart already has a checkout waiting.", {
        cartId,
        canCancel: true,
      });
    }
  }
  if (cart.data.status !== "open") {
    return jsonError(409, "cart_not_open", `The cart is ${cart.data.status} and cannot start a checkout.`);
  }

  // Claim the cart first: hold_item only adds lines to open carts, so the lines read
  // below cannot change underneath us, and a second create-order gets a 409.
  const claimed = await admin
    .from("carts")
    .update({ status: "checkout" })
    .eq("id", cartId)
    .eq("status", "open")
    .select("id");
  if (claimed.error) return databaseError("claim cart", claimed.error);
  if (!claimed.data || claimed.data.length === 0) {
    return jsonError(409, "cart_not_open", "The cart is already in checkout.");
  }

  const fail = async (response: Response): Promise<Response> => {
    await reopenCart(admin, cartId);
    return response;
  };

  const sale = await admin
    .from("sales")
    .select("id, status, fundraiser_name, organizer_merchant_id")
    .eq("id", cart.data.sale_id)
    .maybeSingle();
  if (sale.error) return fail(databaseError("load sale", sale.error));
  if (!sale.data) return fail(jsonError(404, "sale_not_found", "The sale for this cart no longer exists."));
  if (sale.data.status !== "open") return fail(jsonError(409, "sale_not_open", "This sale is not open."));

  const lines = await admin
    .from("cart_lines")
    .select("item_id, household_id, price")
    .eq("cart_id", cartId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (lines.error) return fail(databaseError("load cart lines", lines.error));
  const cartLines = lines.data ?? [];
  if (cartLines.length === 0) return fail(jsonError(409, "cart_empty", "The cart has no items."));

  const householdIds = [...new Set(cartLines.map((line) => line.household_id))];
  const itemIds = cartLines.map((line) => line.item_id);
  const [households, items] = await Promise.all([
    admin
      .from("households")
      .select("id, label, merchant_id_in_paypal, paypal_status, paused")
      .in("id", householdIds),
    admin.from("items").select("id, title").in("id", itemIds),
  ]);
  if (households.error) return fail(databaseError("load households", households.error));
  if (items.error) return fail(databaseError("load items", items.error));

  const built = buildCheckoutUnits({
    lines: cartLines,
    items: items.data ?? [],
    households: households.data ?? [],
    sale: sale.data,
    donationCents,
  });
  if (!built.ok) return fail(jsonError(built.status, built.code, built.message));

  const base = appBaseUrl(env.APP_URL);
  let order: CreatedOrder;
  try {
    order = await createMultiSellerOrder({
      units: built.units.map((unit) => ({
        referenceId: unit.referenceId,
        merchantId: unit.merchantId,
        amount: unit.amount,
        items: unit.items,
        // custom_id comes back on every capture webhook, so a capture we never saw a
        // response for can still be matched to its unit.
        customId: unit.referenceId,
        description: unit.description,
      })),
      returnUrl: `${base}/buyer/cart?checkout=approved&cart=${cartId}`,
      cancelUrl: `${base}/buyer/cart?checkout=cancelled&cart=${cartId}`,
      brandName: "Rummage",
      requestId: `create-${cartId}-${crypto.randomUUID()}`,
    });
  } catch (error) {
    const mapped = paypalErrorResponse(error, "create-order");
    if (mapped) return fail(mapped);
    throw error;
  }

  const stamped = await admin.from("carts").update({ paypal_order_id: order.id }).eq("id", cartId);
  if (stamped.error) return fail(databaseError("store order id", stamped.error));

  const inserted = await admin.from("purchase_units").insert(
    built.units.map((unit) => ({
      cart_id: cartId,
      household_id: unit.householdId,
      reference_id: unit.referenceId,
      amount: unit.amountCents / 100,
      merchant_id: unit.merchantId,
    })),
  );
  if (inserted.error) return fail(databaseError("insert purchase units", inserted.error));

  return Response.json({ orderId: order.id, approveUrl: order.approveUrl ?? null });
}
