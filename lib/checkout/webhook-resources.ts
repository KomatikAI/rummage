import { z } from "zod";

import { toCents } from "@/lib/paypal/money";

import { toCentsFromNumber } from "./order-units";

/** Pure parsers for the non-capture webhook resources Rummage acts on. */

const linkSchema = z.object({ href: z.string(), rel: z.string() });

const refundResourceSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1).optional(),
  amount: z.object({ value: z.string().optional() }).optional(),
  links: z.array(linkSchema).optional(),
});

export type RefundEvent = {
  refundId: string;
  refundStatus: string;
  /** From the refund's rel "up" link (…/v2/payments/captures/{id}). */
  captureId: string | undefined;
  amountValue: string | undefined;
};

const CAPTURE_PATH = /\/v2\/payments\/captures\/([^/?#]+)/;

/** Capture id from a refund's links, if any link points at the capture. */
export function captureIdFromLinks(links: { href: string; rel: string }[] | undefined): string | undefined {
  const ordered = [...(links ?? [])].sort((a, b) => Number(b.rel === "up") - Number(a.rel === "up"));
  for (const link of ordered) {
    const match = CAPTURE_PATH.exec(link.href);
    if (match) return decodeURIComponent(match[1]);
  }
  return undefined;
}

/** Reads a PAYMENT.CAPTURE.REFUNDED resource (a refund). */
export function parseRefundEvent(resource: unknown): RefundEvent | null {
  const parsed = refundResourceSchema.safeParse(resource);
  if (!parsed.success) return null;
  return {
    refundId: parsed.data.id,
    refundStatus: (parsed.data.status ?? "COMPLETED").toUpperCase(),
    captureId: captureIdFromLinks(parsed.data.links),
    amountValue: parsed.data.amount?.value,
  };
}

/**
 * The capture status after a completed refund: REFUNDED when it covers the unit's
 * whole amount (or the amount is unknown), PARTIALLY_REFUNDED when it is smaller.
 */
export function capturedStatusAfterRefund(refundValue: string | undefined, unitAmount: number): string {
  if (!refundValue || !/^\d+\.\d{2}$/.test(refundValue)) return "REFUNDED";
  return toCents(refundValue) >= toCentsFromNumber(unitAmount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

const merchantResourceSchema = z.object({
  merchant_id: z.string().min(1).optional(),
  tracking_id: z.string().min(1).optional(),
});

export type MerchantEvent = { merchantId: string | undefined; trackingId: string | undefined };

/** Reads a MERCHANT.ONBOARDING.COMPLETED or MERCHANT.PARTNER-CONSENT.REVOKED resource. */
export function parseMerchantEvent(resource: unknown): MerchantEvent | null {
  const parsed = merchantResourceSchema.safeParse(resource);
  if (!parsed.success) return null;
  if (!parsed.data.merchant_id && !parsed.data.tracking_id) return null;
  return { merchantId: parsed.data.merchant_id, trackingId: parsed.data.tracking_id };
}
