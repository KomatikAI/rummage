import { describe, expect, it } from "vitest";

import {
  cancelErrorMessage,
  cancelOutcome,
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
    expect(createOrderErrorMessage("cart_in_checkout")).toMatch(/start over/);
  });
});

describe("cancel", () => {
  it("reads a reopened cart", () => {
    expect(cancelOutcome({ ok: true, body: { status: "open" } })).toBe("reopened");
  });

  it("sends a started payment to the order page", () => {
    expect(cancelOutcome({ ok: false, body: { error: "capture_started", orderId: "ORDER-1" } })).toBe("capture_started");
  });

  it("treats everything else as a failure", () => {
    expect(cancelOutcome({ ok: true, body: { status: "checkout" } })).toBe("failed");
    expect(cancelOutcome({ ok: true, body: null })).toBe("failed");
    expect(cancelOutcome({ ok: false, body: { error: "cart_not_in_checkout" } })).toBe("failed");
    expect(cancelOutcome({ ok: false, body: null })).toBe("failed");
  });

  it("maps cancel error codes and falls back for the rest", () => {
    expect(cancelErrorMessage("cart_not_in_checkout")).toMatch(/no longer waiting/);
    expect(cancelErrorMessage("database_error")).toMatch(/could not reopen/);
    expect(cancelErrorMessage(null)).toMatch(/could not reopen/);
  });
});
