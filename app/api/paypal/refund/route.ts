import { z } from "zod";

import { databaseError, jsonError, paypalErrorResponse, readJsonBody, unauthorized } from "@/lib/checkout/http";
import { getSignedInUserId } from "@/lib/checkout/session";
import { refundCapture, type RefundResult } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  captureId: z.string().regex(/^[A-Za-z0-9-]{1,36}$/, "must be a PayPal capture id"),
  reason: z.string().trim().min(1).max(255).optional(),
});

/** Refund states that do not block another attempt. */
const RETRYABLE_REFUND_STATES = new Set(["FAILED", "CANCELLED"]);

/**
 * POST { captureId, reason? } -> { refundId, refundStatus, captureStatus }
 * Full refund of one seller's capture, issued as that seller (auth assertion).
 * Allowed for the sale organizer and for the seller whose household received it.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if (!body.ok) return body.response;
  const { captureId, reason } = body.data;

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const unit = await admin
    .from("purchase_units")
    .select("id, cart_id, household_id, merchant_id, capture_status, refund_id, refund_status")
    .eq("capture_id", captureId)
    .maybeSingle();
  if (unit.error) return databaseError("load purchase unit", unit.error);
  if (!unit.data) return jsonError(404, "capture_not_found", "No purchase has this capture id.");

  const cart = await admin.from("carts").select("sale_id").eq("id", unit.data.cart_id).maybeSingle();
  if (cart.error) return databaseError("load cart", cart.error);
  if (!cart.data) return jsonError(404, "capture_not_found", "No purchase has this capture id.");

  const sale = await admin.from("sales").select("organizer_user_id").eq("id", cart.data.sale_id).maybeSingle();
  if (sale.error) return databaseError("load sale", sale.error);

  let householdOwner: string | null = null;
  if (unit.data.household_id) {
    const household = await admin
      .from("households")
      .select("owner_user_id")
      .eq("id", unit.data.household_id)
      .maybeSingle();
    if (household.error) return databaseError("load household", household.error);
    householdOwner = household.data?.owner_user_id ?? null;
  }

  const isOrganizer = sale.data?.organizer_user_id != null && sale.data.organizer_user_id === userId;
  const isSeller = householdOwner !== null && householdOwner === userId;
  if (!isOrganizer && !isSeller) {
    return jsonError(403, "forbidden", "Only the organizer or the seller who was paid can refund this.");
  }

  if (unit.data.refund_id && !RETRYABLE_REFUND_STATES.has((unit.data.refund_status ?? "").toUpperCase())) {
    return jsonError(409, "already_refunded", "This purchase already has a refund.");
  }
  if ((unit.data.capture_status ?? "").toUpperCase() !== "COMPLETED") {
    return jsonError(409, "not_refundable", "Only completed captures can be refunded.");
  }

  let refund: RefundResult;
  try {
    // The payee recorded on the unit is the merchant that received this capture.
    refund = await refundCapture({
      captureId,
      merchantId: unit.data.merchant_id,
      ...(reason ? { noteToPayer: reason } : {}),
      requestId: `refund-${captureId}`,
    });
  } catch (error) {
    const mapped = paypalErrorResponse(error, "refund");
    if (mapped) return mapped;
    throw error;
  }

  const refundStatus = refund.status.toUpperCase();
  const captureStatus = refundStatus === "COMPLETED" ? "REFUNDED" : unit.data.capture_status;
  const saved = await admin
    .from("purchase_units")
    .update({ refund_id: refund.id, refund_status: refundStatus, capture_status: captureStatus })
    .eq("id", unit.data.id);
  if (saved.error) return databaseError("store refund", saved.error);

  return Response.json({ refundId: refund.id, refundStatus, captureStatus });
}
