import { z } from "zod";
import { encodeId, findLink, paypalRequest } from "./client";
import { PayPalInputError, toPayPalErrorBody } from "./errors";
import { formatIssues, fromCents, positiveMoneyString, toCents } from "./money";
import type {
  CreateOrderRequest,
  Money,
  OrderResponse,
  PayPalErrorBody,
  PayPalErrorDetail,
  PayPalLink,
  PurchaseUnitRequest,
  PurchaseUnitResponse,
  SellerReceivableBreakdown,
} from "./types";

/** PayPal's limit on purchase units in one order. */
export const MAX_PURCHASE_UNITS = 10;

const REPRESENTATION = "return=representation";

const itemSchema = z.object({
  name: z.string().trim().min(1).max(127),
  quantity: z.number().int().min(1).max(999),
  unitAmount: positiveMoneyString,
  sku: z.string().trim().min(1).max(127).optional(),
});

const unitSchema = z
  .object({
    /** Our id for this seller's slice of the order; unique within the order. */
    referenceId: z.string().trim().min(1).max(256),
    /** The seller's PayPal merchant id (merchantIdInPayPal). */
    merchantId: z.string().trim().min(1).max(64),
    amount: positiveMoneyString,
    items: z.array(itemSchema).min(1).optional(),
    customId: z.string().max(127).optional(),
    description: z.string().max(127).optional(),
  })
  .superRefine((unit, ctx) => {
    if (!unit.items) return;
    const total = unit.items.reduce((sum, item) => sum + toCents(item.unitAmount) * item.quantity, 0);
    if (total !== toCents(unit.amount)) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: `must equal the item total ${fromCents(total)}`,
      });
    }
  });

export const createMultiSellerOrderSchema = z
  .object({
    currencyCode: z.literal("USD").default("USD"),
    units: z
      .array(unitSchema)
      .min(1, "at least one purchase unit is required")
      .max(MAX_PURCHASE_UNITS, `at most ${MAX_PURCHASE_UNITS} purchase units (sellers) per order`),
    returnUrl: z.url(),
    cancelUrl: z.url(),
    brandName: z.string().trim().min(1).max(127).optional(),
    /** PayPal-Request-Id for the create call. */
    requestId: z.string().trim().min(1).max(108).optional(),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.units.forEach((unit, index) => {
      if (seen.has(unit.referenceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["units", index, "referenceId"],
          message: `duplicate referenceId "${unit.referenceId}"`,
        });
      }
      seen.add(unit.referenceId);
    });
  });

export type CreateMultiSellerOrderInput = z.input<typeof createMultiSellerOrderSchema>;

export interface CreatedOrder {
  id: string;
  status: string;
  /** Where to send the buyer (rel "payer-action", or "approve" on older responses). */
  approveUrl: string | undefined;
  links: PayPalLink[];
  raw: OrderResponse;
}

/** Builds the Orders v2 body from validated input. Exposed for tests and previews. */
export function buildCreateOrderBody(input: z.output<typeof createMultiSellerOrderSchema>): CreateOrderRequest {
  const currency = input.currencyCode;
  const money = (value: string): Money => ({ currency_code: currency, value });
  const purchaseUnits = input.units.map((unit): PurchaseUnitRequest => {
    const built: PurchaseUnitRequest = {
      reference_id: unit.referenceId,
      payee: { merchant_id: unit.merchantId },
      amount: unit.items ? { ...money(unit.amount), breakdown: { item_total: money(unit.amount) } } : money(unit.amount),
      payment_instruction: { disbursement_mode: "INSTANT" },
    };
    if (unit.description !== undefined) built.description = unit.description;
    if (unit.customId !== undefined) built.custom_id = unit.customId;
    if (unit.items) {
      built.items = unit.items.map((item) => ({
        name: item.name,
        quantity: String(item.quantity),
        unit_amount: money(item.unitAmount),
        ...(item.sku !== undefined ? { sku: item.sku } : {}),
      }));
    }
    return built;
  });
  return {
    intent: "CAPTURE",
    purchase_units: purchaseUnits,
    payment_source: {
      paypal: {
        experience_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          ...(input.brandName !== undefined ? { brand_name: input.brandName } : {}),
        },
      },
    },
  };
}

/** Creates one CAPTURE order with a purchase unit (and payee) per seller. */
export async function createMultiSellerOrder(input: CreateMultiSellerOrderInput): Promise<CreatedOrder> {
  const parsed = createMultiSellerOrderSchema.safeParse(input);
  if (!parsed.success) {
    throw new PayPalInputError("Invalid multi-seller order", formatIssues(parsed.error));
  }
  const response = await paypalRequest<OrderResponse>({
    method: "POST",
    path: "/v2/checkout/orders",
    body: buildCreateOrderBody(parsed.data),
    requestId: parsed.data.requestId,
    prefer: REPRESENTATION,
  });
  const links = response.body.links ?? [];
  return {
    id: response.body.id,
    status: response.body.status,
    approveUrl: findLink(links, "payer-action") ?? findLink(links, "approve"),
    links,
    raw: response.body,
  };
}

// ---------------------------------------------------------------- capture

export interface CaptureUnit {
  referenceId: string;
  merchantId?: string;
  captureId?: string;
  captureStatus?: string;
  /** e.g. "PENDING_REVIEW" for a PENDING capture. */
  captureStatusReason?: string;
  amount?: Money;
  sellerReceivable?: SellerReceivableBreakdown;
  /** The capture's rel "refund" link. */
  refundUrl?: string;
}

export interface CaptureErrorInfo {
  name: string;
  message: string;
  debugId?: string;
  details: PayPalErrorDetail[];
}

interface CaptureResultBase {
  orderId: string;
  /** The order status PayPal reported, when it reported one. */
  orderStatus?: string;
  units: CaptureUnit[];
  debugId?: string;
}

/**
 * - completed: HTTP 201, every unit captured (a capture may still be PENDING).
 * - partial:   HTTP 207 (PARTIALLY_COMPLETED), some units declined; check each unit.
 * - none:      HTTP 422, nothing captured; `error` says why.
 * - timeout:   HTTP 504 after 20 s; call resolveTimedOutCapture(orderId).
 */
export type CaptureResult =
  | (CaptureResultBase & { outcome: "completed"; raw: OrderResponse })
  | (CaptureResultBase & { outcome: "partial"; raw: OrderResponse })
  | (CaptureResultBase & { outcome: "none"; error?: CaptureErrorInfo; raw: OrderResponse | PayPalErrorBody | undefined })
  | (CaptureResultBase & { outcome: "timeout"; raw: unknown });

export type CaptureOutcome = CaptureResult["outcome"];

/** Capture statuses meaning money moved (or will) for that unit. */
const CAPTURED_STATUSES = new Set(["COMPLETED", "PENDING", "PARTIALLY_REFUNDED", "REFUNDED"]);

export function mapPurchaseUnits(units: PurchaseUnitResponse[] | undefined): CaptureUnit[] {
  return (units ?? []).map((unit, index) => {
    const capture = unit.payments?.captures?.[0];
    const mapped: CaptureUnit = { referenceId: unit.reference_id ?? `unit-${index}` };
    if (unit.payee?.merchant_id) mapped.merchantId = unit.payee.merchant_id;
    if (capture) {
      mapped.captureId = capture.id;
      mapped.captureStatus = capture.status;
      if (capture.status_details?.reason) mapped.captureStatusReason = capture.status_details.reason;
      if (capture.amount) mapped.amount = capture.amount;
      if (capture.seller_receivable_breakdown) mapped.sellerReceivable = capture.seller_receivable_breakdown;
      const refundUrl = findLink(capture.links, "refund");
      if (refundUrl) mapped.refundUrl = refundUrl;
    }
    return mapped;
  });
}

function isOrderBody(body: unknown): body is OrderResponse {
  return typeof body === "object" && body !== null && typeof (body as { id?: unknown }).id === "string";
}

/**
 * Captures every purchase unit of an approved order. Never throws for
 * 201/207/422/504; other statuses throw PayPalApiError. Pass a stable
 * `requestId` so a retry after a timeout cannot double-capture.
 */
export async function captureOrder(orderId: string, options: { requestId: string }): Promise<CaptureResult> {
  const response = await paypalRequest<unknown>({
    method: "POST",
    path: `/v2/checkout/orders/${encodeId(orderId)}/capture`,
    body: {},
    requestId: options.requestId,
    prefer: REPRESENTATION,
    expectStatuses: [200, 201, 207, 422, 504],
  });
  const { status, body, debugId } = response;

  if (status === 504) {
    return { outcome: "timeout", orderId, units: [], debugId, raw: body };
  }
  if (status === 422) {
    const error = toPayPalErrorBody(422, body);
    return {
      outcome: "none",
      orderId,
      orderStatus: isOrderBody(body) ? body.status : undefined,
      units: isOrderBody(body) ? mapPurchaseUnits(body.purchase_units) : [],
      error: {
        name: error.name,
        message: error.message,
        debugId: error.debug_id ?? debugId,
        details: error.details ?? [],
      },
      debugId,
      raw: isOrderBody(body) ? body : error,
    };
  }
  const order = body as OrderResponse;
  const base = { orderId: order.id ?? orderId, orderStatus: order.status, units: mapPurchaseUnits(order.purchase_units), debugId };
  // 207 Multi-Status: some units declined. A 200 is an idempotent replay; classify it from the body.
  if (status === 207) return { outcome: "partial", ...base, raw: order };
  if (status === 201) return { outcome: "completed", ...base, raw: order };
  return classifyOrder(order, debugId);
}

/** Reads an order. `asMerchant` adds the seller's PayPal-Auth-Assertion. */
export async function getOrder(orderId: string, options: { asMerchant?: string } = {}): Promise<OrderResponse> {
  const response = await paypalRequest<OrderResponse>({
    method: "GET",
    path: `/v2/checkout/orders/${encodeId(orderId)}`,
    asMerchant: options.asMerchant,
  });
  return response.body;
}

/** Turns a fetched order into the capture union (used after a 504). */
export function classifyOrder(order: OrderResponse, debugId?: string): CaptureResult {
  const units = mapPurchaseUnits(order.purchase_units);
  const captured = units.filter((unit) => unit.captureStatus !== undefined && CAPTURED_STATUSES.has(unit.captureStatus));
  const base = { orderId: order.id, orderStatus: order.status, units, debugId };
  if (units.length > 0 && captured.length === units.length && order.status === "COMPLETED") {
    return { outcome: "completed", ...base, raw: order };
  }
  if (captured.length > 0) return { outcome: "partial", ...base, raw: order };
  return { outcome: "none", ...base, raw: order };
}

/**
 * After a 504 capture timeout: GET the order and map it into the same
 * union. "none" with orderStatus "APPROVED" means nothing was captured yet;
 * retry captureOrder with the SAME requestId.
 */
export async function resolveTimedOutCapture(
  orderId: string,
  options: { asMerchant?: string } = {},
): Promise<CaptureResult> {
  const order = await getOrder(orderId, options);
  return classifyOrder(order);
}
