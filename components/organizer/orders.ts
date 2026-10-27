import type { ParsedOrganizerSummary } from "@/lib/repos/sale-read-repo";

/**
 * The organizer's orders page. Organizers have no row access to purchase_units (only
 * the buyer and the paid seller do), so the page is built from organizer_sale_summary():
 * per-household totals, not individual captures. Refunds go through
 * POST /api/paypal/refund, which allows the organizer, given the transaction (capture)
 * id from the buyer's receipt.
 */

export interface OrderRowView {
  householdId: string;
  label: string;
  /** Completed, unrefunded checkout payments to this household. */
  paidOnline: number;
  /** Cash sales the household recorded. */
  cash: number;
  itemsSold: number;
  itemsCollected: number;
  captureState: "captured" | "none";
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function orderRows(summary: ParsedOrganizerSummary): OrderRowView[] {
  return summary.per_household.map((household) => ({
    householdId: household.household_id,
    label: household.label,
    paidOnline: roundCents(household.gross),
    cash: roundCents(household.cash_total),
    itemsSold: household.items_sold + household.items_cash_sold,
    itemsCollected: household.items_collected,
    captureState: household.gross > 0 ? "captured" : "none",
  }));
}

export interface OrderTotals {
  paidOnline: number;
  cash: number;
  donations: number;
  paidOrders: number;
}

export function orderTotals(summary: ParsedOrganizerSummary): OrderTotals {
  return {
    paidOnline: roundCents(summary.gross_total),
    cash: roundCents(summary.cash_total),
    donations: roundCents(summary.fundraiser_total),
    paidOrders: summary.paid_order_count,
  };
}

// ---------------------------------------------------------------- refunds

/** Same rule as the refund route: letters, digits and hyphens, up to 36 characters. */
export const CAPTURE_ID_PATTERN = /^[A-Za-z0-9-]{1,36}$/;
export const REFUND_REASON_MAX_LENGTH = 255;

export interface RefundRequest {
  captureId: string;
  reason?: string;
}

export type RefundInput = { ok: true; body: RefundRequest } | { ok: false; field: "captureId" | "reason"; message: string };

/** Checks the sheet's fields before anything is sent. */
export function parseRefundInput(captureId: string, reason: string): RefundInput {
  const id = captureId.trim();
  if (id === "") return { ok: false, field: "captureId", message: "Paste the transaction id from the buyer's receipt." };
  if (!CAPTURE_ID_PATTERN.test(id)) {
    return { ok: false, field: "captureId", message: "That does not look like a transaction id. Check it and try again." };
  }
  const note = reason.trim();
  if (note.length > REFUND_REASON_MAX_LENGTH) {
    return { ok: false, field: "reason", message: `Keep the note under ${REFUND_REASON_MAX_LENGTH} characters.` };
  }
  return { ok: true, body: note ? { captureId: id, reason: note } : { captureId: id } };
}

const REFUND_ERRORS: Record<string, string> = {
  unauthorized: "Your session has ended. Sign in again, then retry the refund.",
  forbidden: "That payment is not from this sale, so it cannot be refunded here.",
  capture_not_found: "No payment has that transaction id. Check the receipt and try again.",
  already_refunded: "That payment has already been refunded.",
  not_refundable: "That payment has not finished yet, so it cannot be refunded.",
  paypal_error: "PayPal could not make the refund just now. Try again in a few minutes.",
  invalid_body: "That does not look like a transaction id. Check it and try again.",
};

/** A plain sentence for the refund route's error code. */
export function refundErrorMessage(code: string | undefined): string {
  return (code && REFUND_ERRORS[code]) || "The refund did not go through. Try again in a moment.";
}

/** What to say after the refund route answers 200. */
export function refundSuccessMessage(refundStatus: string): string {
  return refundStatus.toUpperCase() === "COMPLETED"
    ? "Refunded in full. The buyer gets the money back on their original payment."
    : "Refund started. PayPal is still processing it, and the totals update once it completes.";
}
