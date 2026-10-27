import { z } from "zod";

import { captureResultToUnitInputs, summariseCapture } from "@/lib/checkout/capture-mapping";
import { databaseError, jsonError, paypalErrorResponse, readJsonBody, unauthorized } from "@/lib/checkout/http";
import { getSignedInUserId } from "@/lib/checkout/session";
import { captureOrder, resolveTimedOutCapture, type CaptureResult } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CartStatus } from "@/lib/supabase/types";

const bodySchema = z.object({
  orderId: z.string().regex(/^[A-Za-z0-9-]{1,36}$/, "must be a PayPal order id"),
});

/** Carts that can (still) be captured. paid/partial/failed allow an idempotent replay. */
const CAPTURABLE: ReadonlySet<CartStatus> = new Set(["checkout", "partial", "paid", "failed"]);

/**
 * POST { orderId } -> { outcome, units: [{ householdId, referenceId, status, captureId? }] }
 * Captures the buyer's approved order and records each unit with mark_units_captured.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if (!body.ok) return body.response;
  const { orderId } = body.data;

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const cart = await admin
    .from("carts")
    .select("id, buyer_user_id, status")
    .eq("paypal_order_id", orderId)
    .maybeSingle();
  if (cart.error) return databaseError("load cart", cart.error);
  if (!cart.data) return jsonError(404, "order_not_found", "No cart has this PayPal order.");
  if (cart.data.buyer_user_id !== userId) return jsonError(403, "forbidden", "This order belongs to someone else.");
  if (!CAPTURABLE.has(cart.data.status)) {
    return jsonError(409, "cart_not_in_checkout", `The cart is ${cart.data.status} and cannot be captured.`);
  }
  const cartId = cart.data.id;

  const units = await admin
    .from("purchase_units")
    .select("reference_id, household_id, merchant_id, capture_id, capture_status")
    .eq("cart_id", cartId);
  if (units.error) return databaseError("load purchase units", units.error);
  const stored = units.data ?? [];

  let result: CaptureResult;
  try {
    // Same id on every retry for this cart and order: PayPal never captures twice.
    result = await captureOrder(orderId, { requestId: `capture-${cartId}-${orderId}` });
    if (result.outcome === "timeout") result = await resolveTimedOutCapture(orderId);
  } catch (error) {
    const mapped = paypalErrorResponse(error, "capture");
    if (mapped) return mapped;
    throw error;
  }

  const inputs = captureResultToUnitInputs(result, stored);
  if (inputs.length > 0) {
    const marked = await admin.rpc("mark_units_captured", { p_cart: cartId, p_units: inputs });
    if (marked.error) {
      // Money may have moved: the capture webhook replays the same mapping.
      return databaseError("mark units captured", marked.error);
    }
  }

  const summary = summariseCapture(result, stored);
  const failure =
    result.outcome === "none" && "error" in result && result.error
      ? { issues: result.error.details.map((detail) => detail.issue), debugId: result.error.debugId ?? null }
      : {};
  return Response.json({ ...summary, ...failure });
}
