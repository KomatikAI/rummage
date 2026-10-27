import type { CartStatus } from "@/lib/supabase/types";

/**
 * Pure rules for POST /api/paypal/cancel: may a buyer put a cart that is waiting at
 * checkout back to `open`? Also used by create-order to say whether a cart stuck at
 * checkout can be cancelled.
 */

/** The purchase_units columns the decision reads. */
export type CancelUnit = { capture_id: string | null; capture_status: string | null };

export type CancelInput = {
  status: CartStatus;
  paypalOrderId: string | null;
  units: readonly CancelUnit[];
};

export type CancelDecision =
  /** In checkout and nothing captured: delete the pending units and reopen the cart. */
  | { kind: "cancel" }
  /** Already open with no order: nothing to do, answer as if cancelled. */
  | { kind: "already_open" }
  /** PayPal recorded a capture (of any status) for a unit: finish with capture instead. */
  | { kind: "capture_started" }
  /** Paid, partial, failed, abandoned, or an open cart that still names an order. */
  | { kind: "not_in_checkout" };

/**
 * A unit is still pending while PayPal has reported nothing for it (lib/checkout/
 * SCHEMA-GAPS.md). PayPal's own PENDING status means a capture exists and money is on
 * its way, so it counts as started.
 */
export function captureStarted(unit: CancelUnit): boolean {
  return unit.capture_status !== null || unit.capture_id !== null;
}

export function decideCancel({ status, paypalOrderId, units }: CancelInput): CancelDecision {
  if (status === "open") return paypalOrderId === null ? { kind: "already_open" } : { kind: "not_in_checkout" };
  if (status !== "checkout") return { kind: "not_in_checkout" };
  if (units.some(captureStarted)) return { kind: "capture_started" };
  return { kind: "cancel" };
}
