import { z } from "zod";
import { encodeId, paypalRequest } from "./client";
import { PayPalInputError } from "./errors";
import { formatIssues, positiveMoneyString } from "./money";
import type { Refund, RefundRequest } from "./types";

const refundInputSchema = z.object({
  captureId: z.string().trim().min(1),
  /** The seller who received the capture; the refund runs under their auth assertion. */
  merchantId: z.string().trim().min(1),
  /** Omit for a full refund. */
  amount: z.object({ currencyCode: z.literal("USD").default("USD"), value: positiveMoneyString }).optional(),
  noteToPayer: z.string().trim().min(1).max(255).optional(),
  requestId: z.string().trim().min(1).max(108).optional(),
});

export type RefundCaptureInput = z.input<typeof refundInputSchema>;

export interface RefundResult {
  id: string;
  status: string;
  amount?: Refund["amount"];
  raw: Refund;
}

/** Refunds a seller's capture, fully (no amount) or partially. */
export async function refundCapture(input: RefundCaptureInput): Promise<RefundResult> {
  const parsed = refundInputSchema.safeParse(input);
  if (!parsed.success) throw new PayPalInputError("Invalid refund", formatIssues(parsed.error));
  const { captureId, merchantId, amount, noteToPayer, requestId } = parsed.data;

  const body: RefundRequest = {};
  if (amount) body.amount = { currency_code: amount.currencyCode, value: amount.value };
  if (noteToPayer) body.note_to_payer = noteToPayer;

  const response = await paypalRequest<Refund>({
    method: "POST",
    path: `/v2/payments/captures/${encodeId(captureId)}/refund`,
    body,
    requestId,
    asMerchant: merchantId,
    prefer: "return=representation",
  });
  return { id: response.body.id, status: response.body.status, amount: response.body.amount, raw: response.body };
}

/** Reads a refund as the seller who issued it. */
export async function getRefund(refundId: string, merchantId: string): Promise<Refund> {
  const response = await paypalRequest<Refund>({
    method: "GET",
    path: `/v2/payments/refunds/${encodeId(refundId)}`,
    asMerchant: merchantId,
  });
  return response.body;
}
