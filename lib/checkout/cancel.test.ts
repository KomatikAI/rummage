import { describe, expect, it } from "vitest";

import { captureStarted, decideCancel, type CancelUnit } from "./cancel";

const pending: CancelUnit = { capture_id: null, capture_status: null };

describe("captureStarted", () => {
  it("is false only while PayPal has reported nothing", () => {
    expect(captureStarted(pending)).toBe(false);
    expect(captureStarted({ capture_id: "CAP-1", capture_status: "COMPLETED" })).toBe(true);
    expect(captureStarted({ capture_id: "CAP-2", capture_status: "PENDING" })).toBe(true);
    expect(captureStarted({ capture_id: null, capture_status: "DECLINED" })).toBe(true);
    expect(captureStarted({ capture_id: "CAP-3", capture_status: null })).toBe(true);
  });
});

describe("decideCancel", () => {
  it("cancels a checkout cart whose units are all pending", () => {
    expect(decideCancel({ status: "checkout", paypalOrderId: "ORDER-1", units: [pending, pending], captureAttempts: 0 })).toEqual({ kind: "cancel" });
  });

  it("cancels a checkout cart that never got an order or units", () => {
    expect(decideCancel({ status: "checkout", paypalOrderId: null, units: [], captureAttempts: 0 })).toEqual({ kind: "cancel" });
  });

  it("refuses once any unit has a capture, whatever its status", () => {
    for (const unit of [
      { capture_id: "CAP-1", capture_status: "COMPLETED" },
      { capture_id: "CAP-1", capture_status: "PENDING" },
      { capture_id: null, capture_status: "FAILED" },
    ]) {
      expect(decideCancel({ status: "checkout", paypalOrderId: "ORDER-1", units: [pending, unit], captureAttempts: 0 })).toEqual({
        kind: "capture_started",
      });
    }
  });

  it("refuses while a capture is in flight, before PayPal has answered", () => {
    expect(decideCancel({ status: "checkout", paypalOrderId: "ORDER-1", units: [pending], captureAttempts: 1 })).toEqual({
      kind: "capture_started",
    });
  });

  it("treats an open cart with no order as already cancelled", () => {
    expect(decideCancel({ status: "open", paypalOrderId: null, units: [], captureAttempts: 0 })).toEqual({ kind: "already_open" });
  });

  it("refuses every other cart", () => {
    expect(decideCancel({ status: "open", paypalOrderId: "ORDER-1", units: [], captureAttempts: 0 })).toEqual({ kind: "not_in_checkout" });
    for (const status of ["paid", "partial", "failed", "abandoned"] as const) {
      expect(decideCancel({ status, paypalOrderId: "ORDER-1", units: [pending], captureAttempts: 0 })).toEqual({ kind: "not_in_checkout" });
    }
  });
});
