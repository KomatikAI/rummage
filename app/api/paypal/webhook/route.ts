import {
  captureEventToUnitInput,
  isCaptureEventType,
  matchCaptureEventUnit,
  parseCaptureEvent,
  type CaptureEventType,
  type StoredUnit,
} from "@/lib/checkout/capture-mapping";
import { databaseError, jsonError, paypalErrorResponse } from "@/lib/checkout/http";
import { refreshHouseholdOnboarding } from "@/lib/checkout/onboarding";
import { capturedStatusAfterRefund, parseMerchantEvent, parseRefundEvent } from "@/lib/checkout/webhook-resources";
import { parseWebhookEvent, verifyWebhookSignature, type WebhookEvent } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordPayPalEvent, type PayPalEventInput } from "@/lib/supabase/queries";
import type { RummageClient } from "@/lib/supabase/server";

/** null = handled (or nothing to do); a Response = stop and answer with it (PayPal retries non-2xx). */
type HandlerResult = Response | null;

const UNIT_COLUMNS = "id, cart_id, reference_id, household_id, merchant_id, capture_id, capture_status, amount";

async function handleCapture(admin: RummageClient, eventType: CaptureEventType, event: WebhookEvent): Promise<HandlerResult> {
  const capture = parseCaptureEvent(eventType, event.resource);
  if (!capture) return null;

  // 1. By capture id (set when the capture response was recorded).
  const direct = await admin.from("purchase_units").select(UNIT_COLUMNS).eq("capture_id", capture.captureId).maybeSingle();
  if (direct.error) return databaseError("webhook: load unit by capture", direct.error);

  let cartId: string | null = direct.data?.cart_id ?? null;
  let row: StoredUnit | null = direct.data;

  // 2. Else by order id + custom_id (= reference_id), for captures whose response we never saw.
  if (!row && capture.orderId) {
    const cart = await admin.from("carts").select("id").eq("paypal_order_id", capture.orderId).maybeSingle();
    if (cart.error) return databaseError("webhook: load cart by order", cart.error);
    if (cart.data) {
      const units = await admin.from("purchase_units").select(UNIT_COLUMNS).eq("cart_id", cart.data.id);
      if (units.error) return databaseError("webhook: load cart units", units.error);
      row = matchCaptureEventUnit(capture, units.data ?? []);
      cartId = cart.data.id;
    }
  }
  if (!row || !cartId) {
    console.warn("[paypal/webhook] capture event matches no purchase unit", { eventId: event.id });
    return null;
  }

  const input = captureEventToUnitInput(capture, row);
  if (!input) return null;
  const marked = await admin.rpc("mark_units_captured", { p_cart: cartId, p_units: [input] });
  if (marked.error) return databaseError("webhook: mark units captured", marked.error);
  return null;
}

async function handleRefund(admin: RummageClient, event: WebhookEvent): Promise<HandlerResult> {
  const refund = parseRefundEvent(event.resource);
  if (!refund?.captureId) return null;
  const unit = await admin
    .from("purchase_units")
    .select("id, amount, capture_status")
    .eq("capture_id", refund.captureId)
    .maybeSingle();
  if (unit.error) return databaseError("webhook: load refunded unit", unit.error);
  if (!unit.data) {
    console.warn("[paypal/webhook] refund event matches no purchase unit", { eventId: event.id });
    return null;
  }
  const captureStatus =
    refund.refundStatus === "COMPLETED"
      ? capturedStatusAfterRefund(refund.amountValue, unit.data.amount)
      : unit.data.capture_status;
  const saved = await admin
    .from("purchase_units")
    .update({ refund_id: refund.refundId, refund_status: refund.refundStatus, capture_status: captureStatus })
    .eq("id", unit.data.id);
  if (saved.error) return databaseError("webhook: store refund", saved.error);
  return null;
}

async function handleOnboardingCompleted(admin: RummageClient, event: WebhookEvent): Promise<HandlerResult> {
  const merchant = parseMerchantEvent(event.resource);
  if (!merchant?.trackingId || !merchant.merchantId) return null;
  const household = await admin
    .from("households")
    .select("id, tracking_id")
    .eq("tracking_id", merchant.trackingId)
    .maybeSingle();
  if (household.error) return databaseError("webhook: load household", household.error);
  if (!household.data) return null;
  try {
    const refreshed = await refreshHouseholdOnboarding(admin, household.data, merchant.merchantId);
    if (refreshed.kind === "db_error") return databaseError("webhook: store onboarding", { code: refreshed.code });
    if (refreshed.kind === "tracking_mismatch") {
      console.warn("[paypal/webhook] onboarding tracking id mismatch", { eventId: event.id });
    }
  } catch (error) {
    const mapped = paypalErrorResponse(error, "webhook");
    if (mapped) return mapped;
    throw error;
  }
  return null;
}

async function handleConsentRevoked(admin: RummageClient, event: WebhookEvent): Promise<HandlerResult> {
  const merchant = parseMerchantEvent(event.resource);
  if (!merchant) return null;
  const update = { paypal_status: "revoked" as const, paypal_checked_at: new Date().toISOString() };
  const saved = merchant.merchantId
    ? await admin.from("households").update(update).eq("merchant_id_in_paypal", merchant.merchantId)
    : await admin.from("households").update(update).eq("tracking_id", merchant.trackingId ?? "");
  if (saved.error) return databaseError("webhook: store revocation", saved.error);
  return null;
}

async function handleEvent(admin: RummageClient, event: WebhookEvent): Promise<HandlerResult> {
  if (isCaptureEventType(event.eventType)) return handleCapture(admin, event.eventType, event);
  switch (event.eventType) {
    case "PAYMENT.CAPTURE.REFUNDED":
      return handleRefund(admin, event);
    case "MERCHANT.ONBOARDING.COMPLETED":
      return handleOnboardingCompleted(admin, event);
    case "MERCHANT.PARTNER-CONSENT.REVOKED":
      return handleConsentRevoked(admin, event);
    default:
      return null; // recorded, nothing else to do
  }
}

/**
 * POST /api/paypal/webhook: PayPal event deliveries. The signature is verified on
 * the raw body before anything is parsed or stored; every verified event is
 * recorded once in paypal_events, handled, then stamped processed_at.
 */
// @security-gate: webhook
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature({ headers: request.headers, rawBody });
  } catch (error) {
    const mapped = paypalErrorResponse(error, "webhook");
    if (mapped) return mapped;
    throw error;
  }
  if (!verified) return jsonError(400, "invalid_signature", "The webhook signature could not be verified.");

  let event: WebhookEvent;
  try {
    event = parseWebhookEvent(rawBody);
  } catch {
    return jsonError(400, "invalid_event", "The webhook body is not a PayPal event.");
  }

  const admin = createSupabaseAdminClient();
  // parseWebhookEvent checked the shape; the stored payload is the JSON PayPal sent.
  const payload = JSON.parse(rawBody) as PayPalEventInput;
  let isNew: boolean;
  try {
    isNew = await recordPayPalEvent(payload, admin);
  } catch {
    return databaseError("webhook: record event", { code: undefined });
  }

  if (!isNew) {
    // A retried delivery. Skip it unless the first attempt failed before finishing.
    const seen = await admin.from("paypal_events").select("processed_at").eq("event_id", event.id).maybeSingle();
    if (seen.error) return databaseError("webhook: load event", seen.error);
    if (seen.data?.processed_at) return Response.json({ received: true, duplicate: true });
  }

  const handled = await handleEvent(admin, event);
  if (handled) return handled;

  const stamped = await admin
    .from("paypal_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_id", event.id);
  if (stamped.error) return databaseError("webhook: stamp event", stamped.error);

  return Response.json({ received: true, duplicate: !isNew });
}
