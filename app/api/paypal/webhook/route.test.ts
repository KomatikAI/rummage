import { beforeEach, describe, expect, it, vi } from "vitest";

import { eqValue, fakeDb, ok, type FakeQuery, type QueryResolver } from "@/lib/checkout/test-db";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/queries", () => ({ recordPayPalEvent: vi.fn() }));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifyWebhookSignature: vi.fn(),
  getMerchantIntegration: vi.fn(),
}));

import { getMerchantIntegration, PayPalApiError, verifyWebhookSignature } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordPayPalEvent } from "@/lib/supabase/queries";

import { POST } from "./route";

const URL_ = "https://rummage.test/api/paypal/webhook";
const CART = "c0000000-0000-4000-8000-000000000001";
const H1 = "b0000000-0000-4000-8000-000000000001";

const delivery = (body: unknown) =>
  new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "paypal-transmission-id": "tx-1" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const event = (eventType: string, resource: Record<string, unknown>, id = "WH-1") => ({
  id,
  event_type: eventType,
  resource_type: "capture",
  resource,
});

const unitRow = {
  id: "pu-1",
  cart_id: CART,
  reference_id: H1,
  household_id: H1,
  merchant_id: "MERCH1",
  capture_id: null as string | null,
  capture_status: null as string | null,
  amount: 17.5,
};

function setup(resolve: QueryResolver = () => undefined) {
  const db = fakeDb(resolve);
  vi.mocked(createSupabaseAdminClient).mockReturnValue(db.client);
  return db;
}

const stamped = (queries: FakeQuery[]) =>
  queries.some((q) => q.table === "paypal_events" && q.action === "update" && "processed_at" in (q.payload as object));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(verifyWebhookSignature).mockReset();
  vi.mocked(verifyWebhookSignature).mockResolvedValue(true);
  vi.mocked(recordPayPalEvent).mockReset();
  vi.mocked(recordPayPalEvent).mockResolvedValue(true);
  vi.mocked(getMerchantIntegration).mockReset();
});

describe("POST /api/paypal/webhook verification", () => {
  it("verifies the raw body byte for byte, before parsing anything", async () => {
    setup();
    const raw = '{"id":"WH-1",  "event_type":"CHECKOUT.ORDER.APPROVED","resource":{"id":"O-1"}}';
    const response = await POST(delivery(raw));
    expect(response.status).toBe(200);
    const call = vi.mocked(verifyWebhookSignature).mock.calls[0][0];
    expect(call.rawBody).toBe(raw);
    expect((call.headers as Headers).get("paypal-transmission-id")).toBe("tx-1");
  });

  it("400s an unverified delivery and stores nothing", async () => {
    const db = setup();
    vi.mocked(verifyWebhookSignature).mockResolvedValue(false);
    const response = await POST(delivery(event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1" })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_signature" });
    expect(recordPayPalEvent).not.toHaveBeenCalled();
    expect(db.queries).toEqual([]);
  });

  it("502s when PayPal's verify call fails, so PayPal retries", async () => {
    setup();
    vi.mocked(verifyWebhookSignature).mockRejectedValue(
      new PayPalApiError({ status: 500, paypalName: "INTERNAL_SERVER_ERROR", message: "x", method: "POST", path: "/v1" }),
    );
    expect((await POST(delivery(event("X", {})))).status).toBe(502);
  });

  it("400s a verified body that is not a PayPal event", async () => {
    setup();
    const response = await POST(delivery({ hello: "world" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_event" });
  });
});

describe("POST /api/paypal/webhook idempotency", () => {
  it("records an unknown event type and stamps it processed", async () => {
    const db = setup();
    const response = await POST(delivery(event("CHECKOUT.ORDER.APPROVED", { id: "O-1" })));
    expect(await response.json()).toEqual({ received: true, duplicate: false });
    expect(vi.mocked(recordPayPalEvent).mock.calls[0][0]).toMatchObject({ id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED" });
    expect(stamped(db.queries)).toBe(true);
  });

  it("skips a duplicate that was already processed", async () => {
    const db = setup((q) => (q.table === "paypal_events" ? ok({ processed_at: "2026-10-27T00:00:00Z" }) : undefined));
    vi.mocked(recordPayPalEvent).mockResolvedValue(false);
    const response = await POST(delivery(event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1" })));
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(db.queries.some((q) => q.table === "purchase_units")).toBe(false);
    expect(db.rpcs).toEqual([]);
  });

  it("reprocesses a duplicate whose first attempt never finished", async () => {
    const db = setup((q) => {
      if (q.table === "paypal_events" && q.action === "select") return ok({ processed_at: null });
      if (q.table === "purchase_units") return ok({ ...unitRow, capture_id: "CAP-1" });
      return undefined;
    });
    vi.mocked(recordPayPalEvent).mockResolvedValue(false);
    const response = await POST(delivery(event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1", status: "COMPLETED" })));
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(db.rpcs).toHaveLength(1);
    expect(stamped(db.queries)).toBe(true);
  });

  it("500s, without stamping, when the event cannot be recorded", async () => {
    const db = setup();
    vi.mocked(recordPayPalEvent).mockRejectedValue(new Error("db down"));
    expect((await POST(delivery(event("X", {})))).status).toBe(500);
    expect(stamped(db.queries)).toBe(false);
  });
});

describe("POST /api/paypal/webhook capture events", () => {
  it("applies a capture found by capture id", async () => {
    const db = setup((q) => (q.table === "purchase_units" ? ok({ ...unitRow, capture_id: "CAP-1", capture_status: "PENDING" }) : undefined));
    await POST(
      delivery(
        event("PAYMENT.CAPTURE.COMPLETED", {
          id: "CAP-1",
          status: "COMPLETED",
          seller_receivable_breakdown: { net_amount: { currency_code: "USD", value: "16.64" } },
        }),
      ),
    );
    expect(db.rpcs).toEqual([
      {
        fn: "mark_units_captured",
        args: {
          p_cart: CART,
          p_units: [{ reference_id: H1, capture_id: "CAP-1", capture_status: "COMPLETED", seller_receivable: 16.64 }],
        },
      },
    ]);
  });

  it("falls back to the order id and custom_id for a capture it never saw", async () => {
    const db = setup((q) => {
      if (q.table === "purchase_units" && q.single) return ok(null);
      if (q.table === "carts") return ok({ id: CART });
      if (q.table === "purchase_units") {
        return ok([unitRow, { ...unitRow, id: "pu-2", reference_id: "donation", household_id: null, merchant_id: "ORG" }]);
      }
      return undefined;
    });
    await POST(
      delivery(
        event("PAYMENT.CAPTURE.DENIED", {
          id: "CAP-9",
          custom_id: "donation",
          supplementary_data: { related_ids: { order_id: "ORDER-1" } },
        }),
      ),
    );
    const cartLookup = db.queries.find((q) => q.table === "carts");
    expect(eqValue(cartLookup!, "paypal_order_id")).toBe("ORDER-1");
    expect(db.rpcs[0].args).toMatchObject({
      p_units: [{ reference_id: "donation", capture_id: "CAP-9", capture_status: "DECLINED" }],
    });
  });

  it("does not let a late PENDING overwrite a completed capture", async () => {
    const db = setup((q) => (q.table === "purchase_units" ? ok({ ...unitRow, capture_id: "CAP-1", capture_status: "COMPLETED" }) : undefined));
    const response = await POST(delivery(event("PAYMENT.CAPTURE.PENDING", { id: "CAP-1" })));
    expect(response.status).toBe(200);
    expect(db.rpcs).toEqual([]);
    expect(stamped(db.queries)).toBe(true);
  });
});

describe("POST /api/paypal/webhook refund and merchant events", () => {
  it("stores a completed refund and marks the unit refunded", async () => {
    const db = setup((q) =>
      q.table === "purchase_units" && q.action === "select" ? ok({ id: "pu-1", amount: 17.5, capture_status: "COMPLETED" }) : undefined,
    );
    await POST(
      delivery(
        event("PAYMENT.CAPTURE.REFUNDED", {
          id: "REF-1",
          status: "COMPLETED",
          amount: { value: "17.50" },
          links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP-1" }],
        }),
      ),
    );
    const lookup = db.queries.find((q) => q.table === "purchase_units" && q.action === "select");
    expect(eqValue(lookup!, "capture_id")).toBe("CAP-1");
    const update = db.queries.find((q) => q.table === "purchase_units" && q.action === "update");
    expect(update?.payload).toEqual({ refund_id: "REF-1", refund_status: "COMPLETED", capture_status: "REFUNDED" });
  });

  it("marks a smaller refund as partial", async () => {
    const db = setup((q) =>
      q.table === "purchase_units" && q.action === "select" ? ok({ id: "pu-1", amount: 17.5, capture_status: "COMPLETED" }) : undefined,
    );
    await POST(
      delivery(
        event("PAYMENT.CAPTURE.REFUNDED", {
          id: "REF-2",
          amount: { value: "5.00" },
          links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP-1" }],
        }),
      ),
    );
    const update = db.queries.find((q) => q.table === "purchase_units" && q.action === "update");
    expect(update?.payload).toMatchObject({ capture_status: "PARTIALLY_REFUNDED" });
  });

  it("refreshes the household PayPal says finished onboarding", async () => {
    vi.mocked(getMerchantIntegration).mockResolvedValue({
      merchantId: "MERCH1",
      trackingId: "track-1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      hasPaymentScope: true,
      hasRefundScope: true,
      readyToSell: true,
      raw: {},
    });
    const db = setup((q) =>
      q.table === "households" && q.action === "select" ? ok({ id: H1, tracking_id: "track-1" }) : undefined,
    );
    await POST(delivery(event("MERCHANT.ONBOARDING.COMPLETED", { merchant_id: "MERCH1", tracking_id: "track-1" })));
    expect(getMerchantIntegration).toHaveBeenCalledWith({ merchantIdInPayPal: "MERCH1" });
    const update = db.queries.find((q) => q.table === "households" && q.action === "update");
    expect(update?.payload).toMatchObject({ merchant_id_in_paypal: "MERCH1", paypal_status: "ready" });
    expect(eqValue(update!, "id")).toBe(H1);
  });

  it("marks a household revoked when consent is withdrawn", async () => {
    const db = setup();
    await POST(delivery(event("MERCHANT.PARTNER-CONSENT.REVOKED", { merchant_id: "MERCH1" })));
    const update = db.queries.find((q) => q.table === "households" && q.action === "update");
    expect(update?.payload).toMatchObject({ paypal_status: "revoked" });
    expect(eqValue(update!, "merchant_id_in_paypal")).toBe("MERCH1");
    expect(stamped(db.queries)).toBe(true);
  });
});
