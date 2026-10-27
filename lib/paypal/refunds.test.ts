import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthAssertion } from "./auth-assertion";
import { PayPalApiError, PayPalInputError } from "./errors";
import { getRefund, refundCapture } from "./refunds";
import { jsonResponse, mockPayPal, resetPayPalTestState, stubPayPalEnv } from "./test-utils";

beforeEach(() => stubPayPalEnv());
afterEach(resetPayPalTestState);

const CAPTURE_ID = "3C679366HH908993F";
const refundBody = (value: string) => ({
  id: "1JU08902781691411",
  status: "COMPLETED",
  amount: { currency_code: "USD", value },
  seller_payable_breakdown: {
    gross_amount: { currency_code: "USD", value },
    paypal_fee: { currency_code: "USD", value: "0.00" },
    net_amount: { currency_code: "USD", value },
    total_refunded_amount: { currency_code: "USD", value },
  },
  links: [
    { href: "https://api.sandbox.paypal.com/v2/payments/refunds/1JU08902781691411", rel: "self", method: "GET" },
    { href: `https://api.sandbox.paypal.com/v2/payments/captures/${CAPTURE_ID}`, rel: "up", method: "GET" },
  ],
});

describe("refundCapture", () => {
  it("full refund: empty body, seller auth assertion, optional request id", async () => {
    const mock = mockPayPal(() => jsonResponse(201, refundBody("17.50")));
    const result = await refundCapture({ captureId: CAPTURE_ID, merchantId: "SELLERAAA111", requestId: "refund-1" });
    expect(result).toMatchObject({ id: "1JU08902781691411", status: "COMPLETED", amount: { value: "17.50" } });

    const [call] = mock.apiCalls();
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`/v2/payments/captures/${CAPTURE_ID}/refund`);
    expect(call.json).toEqual({});
    expect(call.headers["paypal-auth-assertion"]).toBe(buildAuthAssertion("test-client-id", "SELLERAAA111"));
    expect(call.headers["paypal-request-id"]).toBe("refund-1");
    expect(call.headers["paypal-partner-attribution-id"]).toBe("TEST_BN_CODE");
  });

  it("partial refund sends amount and note_to_payer", async () => {
    const mock = mockPayPal(() => jsonResponse(201, refundBody("2.50")));
    await refundCapture({
      captureId: CAPTURE_ID,
      merchantId: "SELLERAAA111",
      amount: { value: "2.50" },
      noteToPayer: "Mug arrived chipped",
    });
    const [call] = mock.apiCalls();
    expect(call.json).toEqual({
      amount: { currency_code: "USD", value: "2.50" },
      note_to_payer: "Mug arrived chipped",
    });
    expect(call.headers).not.toHaveProperty("paypal-request-id");
  });

  it("rejects a malformed amount before calling PayPal", async () => {
    const mock = mockPayPal(() => jsonResponse(201, refundBody("1.00")));
    await expect(
      refundCapture({ captureId: CAPTURE_ID, merchantId: "SELLERAAA111", amount: { value: "2.5" } }),
    ).rejects.toBeInstanceOf(PayPalInputError);
    expect(mock.calls).toHaveLength(0);
  });

  it("propagates PayPal errors with debug_id", async () => {
    mockPayPal(() =>
      jsonResponse(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
        debug_id: "refund-debug-1",
        details: [{ issue: "CAPTURE_FULLY_REFUNDED", description: "The capture has already been fully refunded" }],
      }),
    );
    const error = (await refundCapture({ captureId: CAPTURE_ID, merchantId: "SELLERAAA111" }).catch(
      (caught: unknown) => caught,
    )) as PayPalApiError;
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error.debugId).toBe("refund-debug-1");
    expect(error.issues).toEqual(["CAPTURE_FULLY_REFUNDED"]);
  });
});

describe("getRefund", () => {
  it("GETs the refund as the seller", async () => {
    const mock = mockPayPal(() => jsonResponse(200, refundBody("17.50")));
    const refund = await getRefund("1JU08902781691411", "SELLERAAA111");
    expect(refund.status).toBe("COMPLETED");
    const [call] = mock.apiCalls();
    expect(call.method).toBe("GET");
    expect(call.path).toBe("/v2/payments/refunds/1JU08902781691411");
    expect(call.headers["paypal-auth-assertion"]).toBe(buildAuthAssertion("test-client-id", "SELLERAAA111"));
  });
});
