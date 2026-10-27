import { z } from "zod";

import type { CaptureOutcome, CaptureResult, CaptureUnit } from "@/lib/paypal";
import type { CapturedUnitInput } from "@/lib/supabase/types";

/**
 * Pure mapping from PayPal capture data to the `p_units` argument of
 * `mark_units_captured(p_cart, p_units)`. Used by the capture route (from the
 * CaptureResult) and by the webhook route (from a PAYMENT.CAPTURE.* resource), so
 * both paths write the same thing and the SQL function stays idempotent.
 */

/** A purchase_units row as the routes load it. */
export type StoredUnit = {
  reference_id: string;
  household_id: string | null;
  merchant_id: string;
  capture_id: string | null;
  capture_status: string | null;
};

type LooseMoney = { value?: string } | undefined;
type LooseReceivable =
  | { net_amount?: LooseMoney; receivable_amount?: LooseMoney; gross_amount?: LooseMoney }
  | undefined;

/** The seller's net for a capture (net, else receivable, else gross), or null. */
export function sellerReceivableValue(breakdown: LooseReceivable): number | null {
  const money = breakdown?.net_amount ?? breakdown?.receivable_amount ?? breakdown?.gross_amount;
  if (!money?.value) return null;
  const value = Number(money.value);
  return Number.isFinite(value) ? value : null;
}

const REFUND_STATES = new Set(["REFUNDED", "PARTIALLY_REFUNDED"]);
const SETTLED_STATES = new Set(["COMPLETED", "DECLINED", "FAILED"]);

/**
 * Whether a capture status from PayPal may overwrite what is stored. Webhooks can
 * arrive late or out of order, so a refunded unit never goes back to COMPLETED and a
 * settled unit never goes back to PENDING.
 */
export function shouldApplyCaptureStatus(current: string | null | undefined, next: string): boolean {
  const stored = current?.toUpperCase() ?? null;
  const incoming = next.toUpperCase();
  if (stored === null) return true;
  if (REFUND_STATES.has(stored)) return REFUND_STATES.has(incoming);
  if (SETTLED_STATES.has(stored) && incoming === "PENDING") return false;
  return true;
}

/** One CaptureUnit from lib/paypal as a mark_units_captured element, or null when uncaptured. */
export function toCapturedUnitInput(unit: CaptureUnit): CapturedUnitInput | null {
  if (!unit.captureStatus) return null;
  return {
    reference_id: unit.referenceId,
    capture_id: unit.captureId ?? null,
    capture_status: unit.captureStatus.toUpperCase(),
    seller_receivable: sellerReceivableValue(unit.sellerReceivable),
  };
}

/**
 * The p_units for a capture result: units PayPal reported a capture status for, that
 * exist in the cart, and whose stored status may be overwritten. Empty for `none`
 * and `timeout` results without captures.
 */
export function captureResultToUnitInputs(result: CaptureResult, stored: StoredUnit[]): CapturedUnitInput[] {
  const byReference = new Map(stored.map((row) => [row.reference_id, row]));
  const inputs: CapturedUnitInput[] = [];
  for (const unit of result.units) {
    const input = toCapturedUnitInput(unit);
    if (!input) continue;
    const row = byReference.get(input.reference_id);
    if (!row || !shouldApplyCaptureStatus(row.capture_status, input.capture_status)) continue;
    inputs.push(input);
  }
  return inputs;
}

export type CaptureUnitSummary = {
  /** null for the donation unit. */
  householdId: string | null;
  referenceId: string;
  /** PayPal capture status, or NOT_CAPTURED. */
  status: string;
  captureId?: string;
};

/** The capture route's response: one entry per stored purchase unit. */
export function summariseCapture(
  result: CaptureResult,
  stored: StoredUnit[],
): { outcome: CaptureOutcome; units: CaptureUnitSummary[] } {
  const reported = new Map(result.units.map((unit) => [unit.referenceId, unit]));
  const units = stored.map((row): CaptureUnitSummary => {
    const unit = reported.get(row.reference_id);
    const incoming = unit?.captureStatus?.toUpperCase();
    const status =
      incoming && shouldApplyCaptureStatus(row.capture_status, incoming)
        ? incoming
        : (row.capture_status?.toUpperCase() ?? "NOT_CAPTURED");
    const captureId = unit?.captureId ?? row.capture_id ?? undefined;
    return {
      householdId: row.household_id,
      referenceId: row.reference_id,
      status,
      ...(captureId ? { captureId } : {}),
    };
  });
  return { outcome: result.outcome, units };
}

// ---------------------------------------------------------------- webhooks

export const CAPTURE_EVENT_TYPES = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
] as const;

export type CaptureEventType = (typeof CAPTURE_EVENT_TYPES)[number];

export function isCaptureEventType(value: string): value is CaptureEventType {
  return (CAPTURE_EVENT_TYPES as readonly string[]).includes(value);
}

const STATUS_FOR_EVENT: Record<CaptureEventType, string> = {
  "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
  "PAYMENT.CAPTURE.DENIED": "DECLINED",
  "PAYMENT.CAPTURE.PENDING": "PENDING",
};

const moneySchema = z.object({ value: z.string().optional() }).optional();

const captureResourceSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1).optional(),
  custom_id: z.string().min(1).optional(),
  payee: z.object({ merchant_id: z.string().min(1).optional() }).optional(),
  seller_receivable_breakdown: z
    .object({ net_amount: moneySchema, receivable_amount: moneySchema, gross_amount: moneySchema })
    .optional(),
  supplementary_data: z
    .object({ related_ids: z.object({ order_id: z.string().min(1).optional() }).optional() })
    .optional(),
});

export type CaptureEvent = {
  captureId: string;
  captureStatus: string;
  orderId: string | undefined;
  /** We send custom_id = reference_id on every purchase unit. */
  customId: string | undefined;
  payeeMerchantId: string | undefined;
  sellerReceivable: number | null;
};

/** Reads a PAYMENT.CAPTURE.* resource. Returns null when it is not a capture. */
export function parseCaptureEvent(eventType: CaptureEventType, resource: unknown): CaptureEvent | null {
  const parsed = captureResourceSchema.safeParse(resource);
  if (!parsed.success) return null;
  const capture = parsed.data;
  return {
    captureId: capture.id,
    captureStatus: (capture.status ?? STATUS_FOR_EVENT[eventType]).toUpperCase(),
    orderId: capture.supplementary_data?.related_ids?.order_id,
    customId: capture.custom_id,
    payeeMerchantId: capture.payee?.merchant_id,
    sellerReceivable: sellerReceivableValue(capture.seller_receivable_breakdown),
  };
}

/**
 * Finds the purchase unit a capture event is about among one cart's units: by
 * capture id, else by custom_id (= reference_id), else by the payee merchant id
 * when exactly one unit has it.
 */
export function matchCaptureEventUnit<Row extends StoredUnit>(event: CaptureEvent, stored: Row[]): Row | null {
  const byCapture = stored.find((row) => row.capture_id === event.captureId);
  if (byCapture) return byCapture;
  if (event.customId) {
    const byReference = stored.find((row) => row.reference_id === event.customId);
    if (byReference) return byReference;
  }
  if (event.payeeMerchantId) {
    const byMerchant = stored.filter((row) => row.merchant_id === event.payeeMerchantId);
    if (byMerchant.length === 1) return byMerchant[0];
  }
  return null;
}

/** The mark_units_captured element for a capture event, or null when it must not apply. */
export function captureEventToUnitInput(event: CaptureEvent, row: StoredUnit): CapturedUnitInput | null {
  if (!shouldApplyCaptureStatus(row.capture_status, event.captureStatus)) return null;
  return {
    reference_id: row.reference_id,
    capture_id: event.captureId,
    capture_status: event.captureStatus,
    seller_receivable: event.sellerReceivable,
  };
}
