/**
 * Plain sentences for the checkout routes' error codes, and the narrow response shapes
 * the cart page reads from POST /api/paypal/create-order and /api/paypal/capture.
 */

export type CreateOrderResponse = { orderId: string; approveUrl: string | null };

export type CaptureOutcome = "completed" | "partial" | "none" | "timeout";

export type CaptureResponse = {
  outcome: CaptureOutcome;
  units: { householdId: string | null; referenceId: string; status: string; captureId?: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateOrderResponse(value: unknown): CreateOrderResponse | null {
  if (!isRecord(value) || typeof value.orderId !== "string" || value.orderId.length === 0) return null;
  return { orderId: value.orderId, approveUrl: typeof value.approveUrl === "string" ? value.approveUrl : null };
}

const OUTCOMES: readonly CaptureOutcome[] = ["completed", "partial", "none", "timeout"];

export function parseCaptureResponse(value: unknown): CaptureResponse | null {
  if (!isRecord(value) || !OUTCOMES.includes(value.outcome as CaptureOutcome) || !Array.isArray(value.units)) {
    return null;
  }
  const units: CaptureResponse["units"] = [];
  for (const unit of value.units) {
    if (!isRecord(unit) || typeof unit.referenceId !== "string" || typeof unit.status !== "string") continue;
    units.push({
      householdId: typeof unit.householdId === "string" ? unit.householdId : null,
      referenceId: unit.referenceId,
      status: unit.status,
      ...(typeof unit.captureId === "string" ? { captureId: unit.captureId } : {}),
    });
  }
  return { outcome: value.outcome as CaptureOutcome, units };
}

/** The `error` code of a route's error body, or null. */
export function errorCode(value: unknown): string | null {
  return isRecord(value) && typeof value.error === "string" ? value.error : null;
}

const CREATE_ORDER_MESSAGES: Record<string, string> = {
  unauthorized: "Your sign-in has ended. Sign in again, then pay.",
  cart_empty: "Your cart is empty. Hold an item first.",
  cart_not_found: "We could not find this cart. Refresh the page and try again.",
  cart_not_open: "This cart is already at checkout. Refresh the page to pick up where you left off.",
  sale_not_open: "This sale is closed, so checkout is off.",
  sale_not_found: "This sale is no longer listed.",
  seller_not_ready: "One table in your cart cannot take payments yet. Remove its items and try again.",
  too_many_households: "Your cart has items from too many tables for one order. Remove a table and try again.",
  donations_not_accepted: "This sale cannot take donations right now. Set the donation to $0 and try again.",
  item_not_payable: "One item in your cart can no longer be paid for. Remove it and try again.",
  paypal_error: "Checkout could not start just now. Wait a moment and try again.",
  paypal_input_rejected: "Checkout could not start for this cart. Remove the last item you added and try again.",
};

export function createOrderErrorMessage(code: string | null): string {
  return (code && CREATE_ORDER_MESSAGES[code]) || "Checkout could not start. Try again in a moment.";
}

const CAPTURE_MESSAGES: Record<string, string> = {
  unauthorized: "Your sign-in has ended. Sign in again to see your order.",
  order_not_found: "We could not match this payment to your cart. Your order page will show what went through.",
  cart_not_in_checkout: "This cart was not waiting for payment. Your order page shows what went through.",
  paypal_error: "We could not confirm the payment yet. Your order page will update once it settles.",
};

export function captureErrorMessage(code: string | null): string {
  return (code && CAPTURE_MESSAGES[code]) || "We could not confirm the payment yet. Check your order page in a moment.";
}

export const CHECKOUT_CANCELLED_MESSAGE = "Checkout closed before paying. Your items are still held.";
export const CHECKOUT_ERROR_MESSAGE = "Checkout ran into a problem and nothing was charged. Try again.";
