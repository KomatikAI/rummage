import { describe, expect, it } from "vitest";

import {
  captureErrorMessage,
  createOrderErrorMessage,
  errorCode,
  parseCaptureResponse,
  parseCreateOrderResponse,
} from "./checkout-messages";

describe("parseCreateOrderResponse", () => {
  it("reads the order id", () => {
    expect(parseCreateOrderResponse({ orderId: "5O190127TN364715T", approveUrl: "https://example.test/a" })).toEqual({
      orderId: "5O190127TN364715T",
      approveUrl: "https://example.test/a",
    });
    expect(parseCreateOrderResponse({ orderId: "X", approveUrl: null })).toEqual({ orderId: "X", approveUrl: null });
  });

  it("rejects anything else", () => {
    expect(parseCreateOrderResponse({ error: "cart_empty" })).toBeNull();
    expect(parseCreateOrderResponse(null)).toBeNull();
    expect(parseCreateOrderResponse({ orderId: "" })).toBeNull();
  });
});

describe("parseCaptureResponse", () => {
  it("reads the outcome and units", () => {
    expect(
      parseCaptureResponse({
        outcome: "partial",
        units: [
          { householdId: "h1", referenceId: "h1", status: "COMPLETED", captureId: "CAP1" },
          { householdId: null, referenceId: "donation", status: "NOT_CAPTURED" },
          { junk: true },
        ],
      }),
    ).toEqual({
      outcome: "partial",
      units: [
        { householdId: "h1", referenceId: "h1", status: "COMPLETED", captureId: "CAP1" },
        { householdId: null, referenceId: "donation", status: "NOT_CAPTURED" },
      ],
    });
  });

  it("rejects unknown outcomes", () => {
    expect(parseCaptureResponse({ outcome: "great", units: [] })).toBeNull();
  });
});

describe("error messages", () => {
  it("reads the error code", () => {
    expect(errorCode({ error: "cart_empty", message: "x" })).toBe("cart_empty");
    expect(errorCode("nope")).toBeNull();
  });

  it("maps known codes and falls back for the rest", () => {
    expect(createOrderErrorMessage("too_many_households")).toMatch(/too many tables/);
    expect(createOrderErrorMessage("something_new")).toMatch(/Checkout could not start/);
    expect(createOrderErrorMessage(null)).toMatch(/Checkout could not start/);
    expect(captureErrorMessage("paypal_error")).toMatch(/could not confirm/);
    expect(captureErrorMessage(null)).toMatch(/order page/);
  });
});
