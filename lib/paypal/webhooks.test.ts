import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PayPalApiError, PayPalInputError } from "./errors";
import { jsonResponse, mockPayPal, resetPayPalTestState, stubPayPalEnv } from "./test-utils";
import {
  createWebhook,
  isKnownWebhookEventType,
  parseWebhookEvent,
  verifyWebhookSignature,
  WEBHOOK_EVENT_TYPES,
} from "./webhooks";

beforeEach(() => stubPayPalEnv());
afterEach(resetPayPalTestState);

// Number formatting (1.10, 2.0) is kept on purpose: verification must embed the raw bytes.
const RAW_EVENT = `{"id":"WH-2WR32451HC0233532-67976317FL4543714","event_version":"1.0","create_time":"2026-10-27T12:00:07.000Z","resource_type":"capture","resource_version":"2.0","event_type":"PAYMENT.CAPTURE.COMPLETED","summary":"Payment completed for $ 17.50 USD","resource":{"id":"3C679366HH908993F","status":"COMPLETED","amount":{"currency_code":"USD","value":"17.50"},"custom_id":"listing-a","supplementary_data":{"related_ids":{"order_id":"5O190127TN364715T"}},"fee_ratio":1.10,"version":2.0},"links":[]}`;

const SIGNATURE_HEADERS = {
  "PAYPAL-AUTH-ALGO": "SHA256withRSA",
  "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
  "PAYPAL-TRANSMISSION-ID": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  "PAYPAL-TRANSMISSION-SIG": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
  "PAYPAL-TRANSMISSION-TIME": "2026-10-27T12:00:08Z",
};

describe("WEBHOOK_EVENT_TYPES", () => {
  it("lists the eight subscribed events", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      "MERCHANT.ONBOARDING.COMPLETED",
      "MERCHANT.PARTNER-CONSENT.REVOKED",
      "CHECKOUT.ORDER.APPROVED",
      "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
      "PAYMENT.CAPTURE.PENDING",
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.CAPTURE.DENIED",
      "PAYMENT.CAPTURE.REFUNDED",
    ]);
    expect(isKnownWebhookEventType("PAYMENT.CAPTURE.DENIED")).toBe(true);
    expect(isKnownWebhookEventType("PAYMENT.SALE.COMPLETED")).toBe(false);
  });
});

describe("createWebhook", () => {
  it("registers the URL with every event type", async () => {
    const mock = mockPayPal(() =>
      jsonResponse(201, {
        id: "0EH40505U7160970P",
        url: "https://rummage.example.com/api/paypal/webhook",
        event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name, description: name })),
        links: [],
      }),
    );
    const webhook = await createWebhook({ url: "https://rummage.example.com/api/paypal/webhook" });
    expect(webhook.id).toBe("0EH40505U7160970P");
    expect(webhook.eventTypes).toEqual([...WEBHOOK_EVENT_TYPES]);
    const [call] = mock.apiCalls();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v1/notifications/webhooks");
    expect(call.json).toEqual({
      url: "https://rummage.example.com/api/paypal/webhook",
      event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })),
    });
  });

  it("rejects non-https URLs before calling PayPal", async () => {
    const mock = mockPayPal(() => jsonResponse(201, {}));
    await expect(createWebhook({ url: "http://localhost:3000/hook" })).rejects.toBeInstanceOf(PayPalInputError);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("verifyWebhookSignature", () => {
  it("returns true on SUCCESS and posts the headers, webhook id and raw event bytes", async () => {
    const mock = mockPayPal(() => jsonResponse(200, { verification_status: "SUCCESS" }));
    await expect(
      verifyWebhookSignature({ headers: SIGNATURE_HEADERS, rawBody: RAW_EVENT, webhookId: "WH-EXPLICIT" }),
    ).resolves.toBe(true);

    const [call] = mock.apiCalls();
    expect(call.path).toBe("/v1/notifications/verify-webhook-signature");
    expect(call.headers["paypal-partner-attribution-id"]).toBe("TEST_BN_CODE");
    expect(call.body).toContain(`"webhook_event":${RAW_EVENT}}`);
    expect(call.json).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: SIGNATURE_HEADERS["PAYPAL-CERT-URL"],
      transmission_id: SIGNATURE_HEADERS["PAYPAL-TRANSMISSION-ID"],
      transmission_sig: SIGNATURE_HEADERS["PAYPAL-TRANSMISSION-SIG"],
      transmission_time: SIGNATURE_HEADERS["PAYPAL-TRANSMISSION-TIME"],
      webhook_id: "WH-EXPLICIT",
      webhook_event: JSON.parse(RAW_EVENT),
    });
  });

  it("accepts a Headers object and defaults webhook_id to PAYPAL_WEBHOOK_ID", async () => {
    const mock = mockPayPal(() => jsonResponse(200, { verification_status: "SUCCESS" }));
    const headers = new Headers();
    for (const [key, value] of Object.entries(SIGNATURE_HEADERS)) headers.set(key.toLowerCase(), value);
    await expect(verifyWebhookSignature({ headers, rawBody: RAW_EVENT })).resolves.toBe(true);
    expect(mock.apiCalls()[0].json).toMatchObject({ webhook_id: "WH-TEST-0001" });
  });

  it("returns false on FAILURE", async () => {
    mockPayPal(() => jsonResponse(200, { verification_status: "FAILURE" }));
    await expect(verifyWebhookSignature({ headers: SIGNATURE_HEADERS, rawBody: RAW_EVENT })).resolves.toBe(false);
  });

  it("returns false without calling PayPal when a header is missing, the cert URL is foreign, or the body is not JSON", async () => {
    const mock = mockPayPal(() => jsonResponse(200, { verification_status: "SUCCESS" }));
    const { "PAYPAL-TRANSMISSION-SIG": _sig, ...missingSig } = SIGNATURE_HEADERS;
    void _sig;
    expect(await verifyWebhookSignature({ headers: missingSig, rawBody: RAW_EVENT })).toBe(false);
    expect(
      await verifyWebhookSignature({
        headers: { ...SIGNATURE_HEADERS, "PAYPAL-CERT-URL": "https://paypal.com.evil.example/cert" },
        rawBody: RAW_EVENT,
      }),
    ).toBe(false);
    expect(await verifyWebhookSignature({ headers: SIGNATURE_HEADERS, rawBody: "not json" })).toBe(false);
    expect(await verifyWebhookSignature({ headers: SIGNATURE_HEADERS, rawBody: "[1,2]" })).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });

  it("propagates a PayPal API error with its debug_id", async () => {
    mockPayPal(() =>
      jsonResponse(400, {
        name: "VALIDATION_ERROR",
        message: "Invalid request - see details",
        debug_id: "verify-debug-1",
        details: [{ field: "webhook_id", issue: "INVALID_RESOURCE_ID", description: "Webhook id is invalid" }],
      }),
    );
    const error = (await verifyWebhookSignature({ headers: SIGNATURE_HEADERS, rawBody: RAW_EVENT }).catch(
      (caught: unknown) => caught,
    )) as PayPalApiError;
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error.debugId).toBe("verify-debug-1");
    expect(error.details[0].field).toBe("webhook_id");
  });
});

describe("parseWebhookEvent", () => {
  it("returns the id, type, resource and create time", () => {
    const event = parseWebhookEvent(RAW_EVENT);
    expect(event).toMatchObject({
      id: "WH-2WR32451HC0233532-67976317FL4543714",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceType: "capture",
      createTime: "2026-10-27T12:00:07.000Z",
      summary: "Payment completed for $ 17.50 USD",
    });
    expect(event.resource).toMatchObject({ id: "3C679366HH908993F", custom_id: "listing-a" });
  });

  it("throws PayPalInputError on non-JSON or a missing resource", () => {
    expect(() => parseWebhookEvent("nope")).toThrow(PayPalInputError);
    expect(() => parseWebhookEvent('{"id":"WH-1","event_type":"X"}')).toThrow(/resource/);
  });
});
