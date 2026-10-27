import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthAssertion } from "./auth-assertion";
import { PayPalApiError, PayPalInputError } from "./errors";
import {
  captureOrder,
  createMultiSellerOrder,
  getOrder,
  resolveTimedOutCapture,
  type CreateMultiSellerOrderInput,
} from "./orders";
import { jsonResponse, mockPayPal, resetPayPalTestState, stubPayPalEnv } from "./test-utils";
import type { OrderResponse } from "./types";

beforeEach(() => stubPayPalEnv());
afterEach(resetPayPalTestState);

const ORDER_ID = "5O190127TN364715T";
const API = "https://api.sandbox.paypal.com";

const twoSellers: CreateMultiSellerOrderInput = {
  units: [
    {
      referenceId: "sale-1-seller-a",
      merchantId: "SELLERAAA111",
      amount: "17.50",
      customId: "listing-a",
      items: [
        { name: "Cast iron pan", quantity: 1, unitAmount: "12.50", sku: "item-101" },
        { name: "Mug", quantity: 2, unitAmount: "2.50" },
      ],
    },
    { referenceId: "sale-1-seller-b", merchantId: "SELLERBBB222", amount: "5.00" },
  ],
  returnUrl: "http://localhost:3000/checkout/return",
  cancelUrl: "http://localhost:3000/checkout/cancel",
  requestId: "create-req-1",
};

function captureLinks(captureId: string) {
  return [
    { href: `${API}/v2/payments/captures/${captureId}`, rel: "self", method: "GET" },
    { href: `${API}/v2/payments/captures/${captureId}/refund`, rel: "refund", method: "POST" },
    { href: `${API}/v2/checkout/orders/${ORDER_ID}`, rel: "up", method: "GET" },
  ];
}

function completedCapture(captureId: string, value: string, fee: string, net: string) {
  return {
    id: captureId,
    status: "COMPLETED",
    amount: { currency_code: "USD", value },
    final_capture: true,
    disbursement_mode: "INSTANT",
    seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
    seller_receivable_breakdown: {
      gross_amount: { currency_code: "USD", value },
      paypal_fee: { currency_code: "USD", value: fee },
      net_amount: { currency_code: "USD", value: net },
    },
    links: captureLinks(captureId),
    create_time: "2026-10-27T12:00:05Z",
    update_time: "2026-10-27T12:00:05Z",
  };
}

const capturedUnitA = {
  reference_id: "sale-1-seller-a",
  payee: { merchant_id: "SELLERAAA111", email_address: "seller-a@personal.example.com" },
  payments: { captures: [completedCapture("3C679366HH908993F", "17.50", "1.10", "16.40")] },
};

const capture201: OrderResponse = {
  id: ORDER_ID,
  status: "COMPLETED",
  payment_source: { paypal: { email_address: "buyer@personal.example.com", account_id: "QYR5Z8XDVJNXQ" } },
  purchase_units: [
    capturedUnitA,
    {
      reference_id: "sale-1-seller-b",
      payee: { merchant_id: "SELLERBBB222" },
      payments: { captures: [completedCapture("8MC585209K746392H", "5.00", "0.65", "4.35")] },
    },
  ],
  payer: { payer_id: "QYR5Z8XDVJNXQ", email_address: "buyer@personal.example.com" },
  links: [{ href: `${API}/v2/checkout/orders/${ORDER_ID}`, rel: "self", method: "GET" }],
};

const capture207: OrderResponse = {
  ...capture201,
  status: "PARTIALLY_COMPLETED",
  purchase_units: [
    capturedUnitA,
    {
      reference_id: "sale-1-seller-b",
      payee: { merchant_id: "SELLERBBB222" },
      payments: {
        captures: [
          {
            id: "0TX29340JU8711740",
            status: "DECLINED",
            amount: { currency_code: "USD", value: "5.00" },
            final_capture: true,
            links: [{ href: `${API}/v2/payments/captures/0TX29340JU8711740`, rel: "self", method: "GET" }],
          },
        ],
      },
    },
  ],
};

const capture422 = {
  name: "UNPROCESSABLE_ENTITY",
  message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
  debug_id: "90957fca61718",
  details: [
    {
      issue: "INSTRUMENT_DECLINED",
      description: "The instrument presented was either declined by the processor or bank, or it can't be used for this payment.",
    },
  ],
  links: [{ href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`, rel: "redirect", method: "GET" }],
};

describe("createMultiSellerOrder", () => {
  it("builds one purchase unit per seller with payee, breakdown, items and INSTANT disbursement", async () => {
    const mock = mockPayPal(() =>
      jsonResponse(201, {
        id: ORDER_ID,
        status: "PAYER_ACTION_REQUIRED",
        links: [
          { href: `${API}/v2/checkout/orders/${ORDER_ID}`, rel: "self", method: "GET" },
          { href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`, rel: "payer-action", method: "GET" },
        ],
      }),
    );
    const order = await createMultiSellerOrder(twoSellers);
    expect(order.id).toBe(ORDER_ID);
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(order.approveUrl).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${ORDER_ID}`);

    const [call] = mock.apiCalls();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v2/checkout/orders");
    expect(call.headers["paypal-request-id"]).toBe("create-req-1");
    expect(call.headers.prefer).toBe("return=representation");
    expect(call.headers).not.toHaveProperty("paypal-auth-assertion");
    expect(call.json).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "sale-1-seller-a",
          custom_id: "listing-a",
          payee: { merchant_id: "SELLERAAA111" },
          amount: {
            currency_code: "USD",
            value: "17.50",
            breakdown: { item_total: { currency_code: "USD", value: "17.50" } },
          },
          items: [
            { name: "Cast iron pan", quantity: "1", unit_amount: { currency_code: "USD", value: "12.50" }, sku: "item-101" },
            { name: "Mug", quantity: "2", unit_amount: { currency_code: "USD", value: "2.50" } },
          ],
          payment_instruction: { disbursement_mode: "INSTANT" },
        },
        {
          reference_id: "sale-1-seller-b",
          payee: { merchant_id: "SELLERBBB222" },
          amount: { currency_code: "USD", value: "5.00" },
          payment_instruction: { disbursement_mode: "INSTANT" },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: "http://localhost:3000/checkout/return",
            cancel_url: "http://localhost:3000/checkout/cancel",
          },
        },
      },
    });
    expect(JSON.stringify(call.json)).not.toContain("platform_fees");
  });

  const unit = (index: number) => ({ referenceId: `ref-${index}`, merchantId: `M${index}`, amount: "1.00" });
  const base = { returnUrl: "http://localhost:3000/r", cancelUrl: "http://localhost:3000/c" };

  async function issuesFor(input: CreateMultiSellerOrderInput): Promise<string[]> {
    const mock = mockPayPal(() => jsonResponse(201, { id: "X", status: "CREATED", links: [] }));
    const error = await createMultiSellerOrder(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayPalInputError);
    expect(mock.calls).toHaveLength(0);
    return (error as PayPalInputError).issues;
  }

  it("rejects 11 purchase units", async () => {
    const issues = await issuesFor({ ...base, units: Array.from({ length: 11 }, (_, index) => unit(index)) });
    expect(issues.join()).toMatch(/at most 10/);
  });

  it("rejects zero purchase units", async () => {
    expect((await issuesFor({ ...base, units: [] })).join()).toMatch(/at least one/);
  });

  it("accepts exactly 10 purchase units", async () => {
    mockPayPal(() => jsonResponse(201, { id: "X", status: "CREATED", links: [] }));
    await expect(createMultiSellerOrder({ ...base, units: Array.from({ length: 10 }, (_, i) => unit(i)) })).resolves.toMatchObject({
      id: "X",
    });
  });

  it("rejects duplicate reference ids", async () => {
    const issues = await issuesFor({ ...base, units: [unit(1), { ...unit(2), referenceId: "ref-1" }] });
    expect(issues).toEqual(['units.1.referenceId: duplicate referenceId "ref-1"']);
  });

  it.each(["12.5", "12", "1,000.00", "-1.00", "0.00", "1.005", "01.00"])("rejects the amount %s", async (amount) => {
    const issues = await issuesFor({ ...base, units: [{ ...unit(1), amount }] });
    expect(issues[0]).toMatch(/^units\.0\.amount: /);
  });

  it("rejects an amount that differs from the item total", async () => {
    const issues = await issuesFor({
      ...base,
      units: [{ ...unit(1), amount: "3.00", items: [{ name: "Lamp", quantity: 2, unitAmount: "1.25" }] }],
    });
    expect(issues).toEqual(["units.0.amount: must equal the item total 2.50"]);
  });

  it("rejects non-USD currency and bad URLs", async () => {
    const issues = await issuesFor({
      units: [unit(1)],
      returnUrl: "not a url",
      cancelUrl: "http://localhost:3000/c",
      currencyCode: "EUR" as "USD",
    });
    expect(issues.some((issue) => issue.startsWith("currencyCode"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("returnUrl"))).toBe(true);
  });
});

describe("captureOrder", () => {
  it("201 COMPLETED maps every unit to outcome completed", async () => {
    const mock = mockPayPal(() => jsonResponse(201, capture201));
    const result = await captureOrder(ORDER_ID, { requestId: "cap-req-1" });

    const [call] = mock.apiCalls();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/v2/checkout/orders/${ORDER_ID}/capture`);
    expect(call.body).toBe("{}");
    expect(call.headers["paypal-request-id"]).toBe("cap-req-1");
    expect(call.headers.prefer).toBe("return=representation");

    expect(result.outcome).toBe("completed");
    expect(result.orderStatus).toBe("COMPLETED");
    expect(result.units).toEqual([
      {
        referenceId: "sale-1-seller-a",
        merchantId: "SELLERAAA111",
        captureId: "3C679366HH908993F",
        captureStatus: "COMPLETED",
        amount: { currency_code: "USD", value: "17.50" },
        sellerReceivable: {
          gross_amount: { currency_code: "USD", value: "17.50" },
          paypal_fee: { currency_code: "USD", value: "1.10" },
          net_amount: { currency_code: "USD", value: "16.40" },
        },
        refundUrl: `${API}/v2/payments/captures/3C679366HH908993F/refund`,
      },
      expect.objectContaining({ referenceId: "sale-1-seller-b", captureId: "8MC585209K746392H", captureStatus: "COMPLETED" }),
    ]);
  });

  it("207 PARTIALLY_COMPLETED maps to partial with the declined unit visible", async () => {
    mockPayPal(() => jsonResponse(207, capture207));
    const result = await captureOrder(ORDER_ID, { requestId: "cap-req-2" });
    expect(result.outcome).toBe("partial");
    expect(result.orderStatus).toBe("PARTIALLY_COMPLETED");
    expect(result.units.map((unit) => [unit.referenceId, unit.captureStatus])).toEqual([
      ["sale-1-seller-a", "COMPLETED"],
      ["sale-1-seller-b", "DECLINED"],
    ]);
    expect(result.units[1].refundUrl).toBeUndefined();
    expect(result.units[1].sellerReceivable).toBeUndefined();
  });

  it("422 maps to none with the error name, issues and debug_id, without throwing", async () => {
    mockPayPal(() => jsonResponse(422, capture422));
    const result = await captureOrder(ORDER_ID, { requestId: "cap-req-3" });
    expect(result.outcome).toBe("none");
    if (result.outcome !== "none") throw new Error("unreachable");
    expect(result.units).toEqual([]);
    expect(result.error).toMatchObject({ name: "UNPROCESSABLE_ENTITY", debugId: "90957fca61718" });
    expect(result.error?.details.map((detail) => detail.issue)).toEqual(["INSTRUMENT_DECLINED"]);
  });

  it("504 maps to timeout without throwing", async () => {
    mockPayPal(() => new Response(null, { status: 504, headers: { "paypal-debug-id": "timeout-debug" } }));
    const result = await captureOrder(ORDER_ID, { requestId: "cap-req-4" });
    expect(result).toMatchObject({ outcome: "timeout", orderId: ORDER_ID, units: [], debugId: "timeout-debug" });
  });

  it("other statuses throw PayPalApiError", async () => {
    mockPayPal(() =>
      jsonResponse(404, { name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist.", debug_id: "nf1" }),
    );
    await expect(captureOrder("NOPE", { requestId: "r" })).rejects.toBeInstanceOf(PayPalApiError);
  });
});

describe("getOrder and resolveTimedOutCapture", () => {
  it("getOrder sends the auth assertion only when asMerchant is given", async () => {
    const mock = mockPayPal(() => jsonResponse(200, capture201));
    await getOrder(ORDER_ID);
    await getOrder(ORDER_ID, { asMerchant: "SELLERAAA111" });
    const [plain, asSeller] = mock.apiCalls();
    expect(plain.method).toBe("GET");
    expect(plain.headers).not.toHaveProperty("paypal-auth-assertion");
    expect(asSeller.headers["paypal-auth-assertion"]).toBe(buildAuthAssertion("test-client-id", "SELLERAAA111"));
  });

  it("maps a COMPLETED order to completed", async () => {
    const mock = mockPayPal(() => jsonResponse(200, capture201));
    const result = await resolveTimedOutCapture(ORDER_ID, { asMerchant: "SELLERAAA111" });
    expect(result.outcome).toBe("completed");
    expect(result.units).toHaveLength(2);
    expect(mock.apiCalls()[0].path).toBe(`/v2/checkout/orders/${ORDER_ID}`);
    expect(mock.apiCalls()[0].headers).toHaveProperty("paypal-auth-assertion");
  });

  it("maps a mixed order to partial", async () => {
    mockPayPal(() => jsonResponse(200, capture207));
    expect((await resolveTimedOutCapture(ORDER_ID)).outcome).toBe("partial");
  });

  it("maps an APPROVED order with no captures to none (safe to retry the capture)", async () => {
    mockPayPal(() =>
      jsonResponse(200, {
        id: ORDER_ID,
        status: "APPROVED",
        purchase_units: [
          { reference_id: "sale-1-seller-a", payee: { merchant_id: "SELLERAAA111" } },
          { reference_id: "sale-1-seller-b", payee: { merchant_id: "SELLERBBB222" } },
        ],
      }),
    );
    const result = await resolveTimedOutCapture(ORDER_ID);
    expect(result).toMatchObject({ outcome: "none", orderStatus: "APPROVED" });
    expect(result.units.every((unit) => unit.captureId === undefined)).toBe(true);
  });

  it("treats a PENDING capture as captured", async () => {
    const pending = structuredClone(capture201);
    const capture = pending.purchase_units?.[1].payments?.captures?.[0];
    if (capture) {
      capture.status = "PENDING";
      capture.status_details = { reason: "PENDING_REVIEW" };
    }
    mockPayPal(() => jsonResponse(200, pending));
    const result = await resolveTimedOutCapture(ORDER_ID);
    expect(result.outcome).toBe("completed");
    expect(result.units[1]).toMatchObject({ captureStatus: "PENDING", captureStatusReason: "PENDING_REVIEW" });
  });
});
