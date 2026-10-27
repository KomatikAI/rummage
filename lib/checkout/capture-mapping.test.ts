import { describe, expect, it } from "vitest";

import type { CaptureResult, CaptureUnit, OrderResponse } from "@/lib/paypal";

import {
  captureEventToUnitInput,
  captureResultToUnitInputs,
  isCaptureEventType,
  matchCaptureEventUnit,
  parseCaptureEvent,
  sellerReceivableValue,
  shouldApplyCaptureStatus,
  summariseCapture,
  toCapturedUnitInput,
  type StoredUnit,
} from "./capture-mapping";

const HH_A = "b0000000-0000-4000-8000-000000000001";
const HH_B = "b0000000-0000-4000-8000-000000000002";

const order: OrderResponse = { id: "ORDER-1", status: "COMPLETED" };

function stored(overrides: Partial<StoredUnit> & { reference_id: string }): StoredUnit {
  return {
    household_id: overrides.reference_id === "donation" ? null : overrides.reference_id,
    merchant_id: `M-${overrides.reference_id.slice(-1)}`,
    capture_id: null,
    capture_status: null,
    ...overrides,
  };
}

const unit = (referenceId: string, captureStatus?: string, captureId?: string): CaptureUnit => ({
  referenceId,
  ...(captureStatus ? { captureStatus } : {}),
  ...(captureId ? { captureId } : {}),
  sellerReceivable: { gross_amount: { currency_code: "USD", value: "10.00" }, net_amount: { currency_code: "USD", value: "9.41" } },
});

const rows = [stored({ reference_id: HH_A }), stored({ reference_id: HH_B }), stored({ reference_id: "donation" })];

describe("sellerReceivableValue", () => {
  it("prefers net, then receivable, then gross", () => {
    expect(sellerReceivableValue({ net_amount: { value: "9.41" }, gross_amount: { value: "10.00" } })).toBe(9.41);
    expect(sellerReceivableValue({ receivable_amount: { value: "9.50" }, gross_amount: { value: "10.00" } })).toBe(9.5);
    expect(sellerReceivableValue({ gross_amount: { value: "10.00" } })).toBe(10);
  });

  it("returns null when missing or not a number", () => {
    expect(sellerReceivableValue(undefined)).toBeNull();
    expect(sellerReceivableValue({ net_amount: { value: "abc" } })).toBeNull();
    expect(sellerReceivableValue({ net_amount: {} })).toBeNull();
  });
});

describe("shouldApplyCaptureStatus", () => {
  it.each([
    [null, "COMPLETED", true],
    [null, "PENDING", true],
    ["PENDING", "COMPLETED", true],
    ["PENDING", "DECLINED", true],
    ["COMPLETED", "COMPLETED", true],
    ["COMPLETED", "PENDING", false],
    ["DECLINED", "PENDING", false],
    ["REFUNDED", "COMPLETED", false],
    ["PARTIALLY_REFUNDED", "COMPLETED", false],
    ["REFUNDED", "REFUNDED", true],
    ["completed", "pending", false],
  ] as const)("%s -> %s is %s", (current, next, expected) => {
    expect(shouldApplyCaptureStatus(current, next)).toBe(expected);
  });
});

describe("toCapturedUnitInput", () => {
  it("maps a captured unit", () => {
    expect(toCapturedUnitInput(unit(HH_A, "completed", "CAP-A"))).toEqual({
      reference_id: HH_A,
      capture_id: "CAP-A",
      capture_status: "COMPLETED",
      seller_receivable: 9.41,
    });
  });

  it("skips a unit PayPal reported no capture for", () => {
    expect(toCapturedUnitInput(unit(HH_A))).toBeNull();
  });
});

describe("captureResultToUnitInputs", () => {
  it("completed: every unit", () => {
    const result: CaptureResult = {
      outcome: "completed",
      orderId: "ORDER-1",
      units: [unit(HH_A, "COMPLETED", "CAP-A"), unit(HH_B, "PENDING", "CAP-B"), unit("donation", "COMPLETED", "CAP-D")],
      raw: order,
    };
    expect(captureResultToUnitInputs(result, rows).map((u) => [u.reference_id, u.capture_status])).toEqual([
      [HH_A, "COMPLETED"],
      [HH_B, "PENDING"],
      ["donation", "COMPLETED"],
    ]);
  });

  it("partial: declined units are passed through so their holds are released", () => {
    const result: CaptureResult = {
      outcome: "partial",
      orderId: "ORDER-1",
      units: [unit(HH_A, "COMPLETED", "CAP-A"), unit(HH_B, "DECLINED", "CAP-B")],
      raw: { ...order, status: "PARTIALLY_COMPLETED" },
    };
    expect(captureResultToUnitInputs(result, rows).map((u) => u.capture_status)).toEqual(["COMPLETED", "DECLINED"]);
  });

  it("none and timeout without captures: nothing to record", () => {
    const none: CaptureResult = { outcome: "none", orderId: "ORDER-1", units: [], raw: undefined };
    const timeout: CaptureResult = { outcome: "timeout", orderId: "ORDER-1", units: [], raw: null };
    expect(captureResultToUnitInputs(none, rows)).toEqual([]);
    expect(captureResultToUnitInputs(timeout, rows)).toEqual([]);
  });

  it("drops unknown reference ids and units already refunded", () => {
    const result: CaptureResult = {
      outcome: "completed",
      orderId: "ORDER-1",
      units: [unit("stranger", "COMPLETED", "CAP-X"), unit(HH_A, "COMPLETED", "CAP-A")],
      raw: order,
    };
    const refunded = [stored({ reference_id: HH_A, capture_status: "REFUNDED", capture_id: "CAP-A" })];
    expect(captureResultToUnitInputs(result, refunded)).toEqual([]);
  });
});

describe("summariseCapture", () => {
  it("returns one entry per stored unit with household ids", () => {
    const result: CaptureResult = {
      outcome: "partial",
      orderId: "ORDER-1",
      units: [unit(HH_A, "COMPLETED", "CAP-A"), unit(HH_B, "DECLINED", "CAP-B")],
      raw: order,
    };
    expect(summariseCapture(result, rows)).toEqual({
      outcome: "partial",
      units: [
        { householdId: HH_A, referenceId: HH_A, status: "COMPLETED", captureId: "CAP-A" },
        { householdId: HH_B, referenceId: HH_B, status: "DECLINED", captureId: "CAP-B" },
        { householdId: null, referenceId: "donation", status: "NOT_CAPTURED" },
      ],
    });
  });

  it("keeps a stored refund over a replayed COMPLETED", () => {
    const result: CaptureResult = { outcome: "completed", orderId: "ORDER-1", units: [unit(HH_A, "COMPLETED", "CAP-A")], raw: order };
    const refunded = [stored({ reference_id: HH_A, capture_status: "REFUNDED", capture_id: "CAP-A" })];
    expect(summariseCapture(result, refunded).units[0]).toMatchObject({ status: "REFUNDED", captureId: "CAP-A" });
  });
});

describe("capture webhook mapping", () => {
  const resource = {
    id: "CAP-A",
    status: "COMPLETED",
    custom_id: HH_A,
    payee: { merchant_id: "M-1" },
    seller_receivable_breakdown: { gross_amount: { value: "10.00" }, net_amount: { value: "9.41" } },
    supplementary_data: { related_ids: { order_id: "ORDER-1" } },
  };

  it("recognises capture event types", () => {
    expect(isCaptureEventType("PAYMENT.CAPTURE.COMPLETED")).toBe(true);
    expect(isCaptureEventType("PAYMENT.CAPTURE.DENIED")).toBe(true);
    expect(isCaptureEventType("PAYMENT.CAPTURE.REFUNDED")).toBe(false);
  });

  it("parses a capture resource", () => {
    expect(parseCaptureEvent("PAYMENT.CAPTURE.COMPLETED", resource)).toEqual({
      captureId: "CAP-A",
      captureStatus: "COMPLETED",
      orderId: "ORDER-1",
      customId: HH_A,
      payeeMerchantId: "M-1",
      sellerReceivable: 9.41,
    });
  });

  it("falls back to the event type for the status", () => {
    expect(parseCaptureEvent("PAYMENT.CAPTURE.DENIED", { id: "CAP-B" })?.captureStatus).toBe("DECLINED");
  });

  it("returns null for a resource that is not a capture", () => {
    expect(parseCaptureEvent("PAYMENT.CAPTURE.COMPLETED", { status: "COMPLETED" })).toBeNull();
    expect(parseCaptureEvent("PAYMENT.CAPTURE.COMPLETED", "nope")).toBeNull();
  });

  it("matches by capture id, then custom_id, then a unique payee", () => {
    const event = parseCaptureEvent("PAYMENT.CAPTURE.COMPLETED", resource)!;
    const withCapture = [stored({ reference_id: HH_B, capture_id: "CAP-A" }), stored({ reference_id: HH_A })];
    expect(matchCaptureEventUnit(event, withCapture)?.reference_id).toBe(HH_B);
    expect(matchCaptureEventUnit(event, rows)?.reference_id).toBe(HH_A);

    const byPayee = { ...event, customId: undefined };
    expect(matchCaptureEventUnit(byPayee, [stored({ reference_id: HH_A, merchant_id: "M-1" })])?.reference_id).toBe(HH_A);
    const ambiguous = [stored({ reference_id: HH_A, merchant_id: "M-1" }), stored({ reference_id: HH_B, merchant_id: "M-1" })];
    expect(matchCaptureEventUnit(byPayee, ambiguous)).toBeNull();
  });

  it("builds the same mark_units_captured element as the capture route", () => {
    const event = parseCaptureEvent("PAYMENT.CAPTURE.COMPLETED", resource)!;
    expect(captureEventToUnitInput(event, rows[0])).toEqual({
      reference_id: HH_A,
      capture_id: "CAP-A",
      capture_status: "COMPLETED",
      seller_receivable: 9.41,
    });
    expect(captureEventToUnitInput(event, stored({ reference_id: HH_A, capture_status: "REFUNDED" }))).toBeNull();
  });
});
