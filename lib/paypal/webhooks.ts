import { z } from "zod";
import { paypalRequest } from "./client";
import { getPayPalConfig } from "./config";
import { PayPalInputError } from "./errors";
import { formatIssues } from "./money";
import type { CreateWebhookRequest, VerifyWebhookSignatureResponse, WebhookResponse } from "./types";

/** Every event Rummage subscribes to. */
export const WEBHOOK_EVENT_TYPES = [
  "MERCHANT.ONBOARDING.COMPLETED",
  "MERCHANT.PARTNER-CONSENT.REVOKED",
  "CHECKOUT.ORDER.APPROVED",
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isKnownWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export interface CreatedWebhook {
  id: string;
  url: string;
  eventTypes: string[];
  raw: WebhookResponse;
}

/** Registers a webhook listener for WEBHOOK_EVENT_TYPES (or the types given). */
export async function createWebhook(input: {
  url: string;
  eventTypes?: readonly string[];
}): Promise<CreatedWebhook> {
  const url = z.url().refine((value) => value.startsWith("https://"), "must be https").safeParse(input.url);
  if (!url.success) throw new PayPalInputError("Invalid webhook url", formatIssues(url.error));
  const body: CreateWebhookRequest = {
    url: url.data,
    event_types: (input.eventTypes ?? WEBHOOK_EVENT_TYPES).map((name) => ({ name })),
  };
  const response = await paypalRequest<WebhookResponse>({
    method: "POST",
    path: "/v1/notifications/webhooks",
    body,
  });
  return {
    id: response.body.id,
    url: response.body.url,
    eventTypes: (response.body.event_types ?? []).map((type) => type.name),
    raw: response.body,
  };
}

// ---------------------------------------------------------------- verification

export const WEBHOOK_HEADERS = {
  authAlgo: "paypal-auth-algo",
  certUrl: "paypal-cert-url",
  transmissionId: "paypal-transmission-id",
  transmissionSig: "paypal-transmission-sig",
  transmissionTime: "paypal-transmission-time",
} as const;

function readHeader(headers: Headers | Record<string, string>, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name)?.trim() || undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key]?.trim() || undefined : undefined;
}

function isPayPalCertUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"));
  } catch {
    return false;
  }
}

/**
 * Asks PayPal whether a delivery is genuine. Returns false (without calling
 * PayPal) when a signature header is missing, the cert URL is not a PayPal
 * https URL, or the body is not a JSON object. The raw body is embedded byte
 * for byte as `webhook_event`, because re-serialising a parsed event can
 * change it and fail verification.
 */
export async function verifyWebhookSignature(input: {
  headers: Headers | Record<string, string>;
  rawBody: string;
  /** Defaults to PAYPAL_WEBHOOK_ID. */
  webhookId?: string;
}): Promise<boolean> {
  const authAlgo = readHeader(input.headers, WEBHOOK_HEADERS.authAlgo);
  const certUrl = readHeader(input.headers, WEBHOOK_HEADERS.certUrl);
  const transmissionId = readHeader(input.headers, WEBHOOK_HEADERS.transmissionId);
  const transmissionSig = readHeader(input.headers, WEBHOOK_HEADERS.transmissionSig);
  const transmissionTime = readHeader(input.headers, WEBHOOK_HEADERS.transmissionTime);
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return false;
  if (!isPayPalCertUrl(certUrl)) return false;

  const rawBody = input.rawBody.trim();
  try {
    const event: unknown = JSON.parse(rawBody);
    if (typeof event !== "object" || event === null || Array.isArray(event)) return false;
  } catch {
    return false;
  }

  const webhookId = input.webhookId ?? getPayPalConfig().webhookId;
  const envelope = JSON.stringify({
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: webhookId,
  });
  const body = `${envelope.slice(0, -1)},"webhook_event":${rawBody}}`;

  const response = await paypalRequest<VerifyWebhookSignatureResponse>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    rawBody: body,
  });
  return response.body.verification_status === "SUCCESS";
}

// ---------------------------------------------------------------- parsing

const webhookEventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().optional(),
  resource: z.record(z.string(), z.unknown()),
  create_time: z.string().optional(),
  summary: z.string().optional(),
  event_version: z.string().optional(),
  resource_version: z.string().optional(),
});

export interface WebhookEvent {
  id: string;
  eventType: string;
  resourceType: string | undefined;
  resource: Record<string, unknown>;
  createTime: string | undefined;
  summary: string | undefined;
  raw: z.infer<typeof webhookEventSchema>;
}

/** Parses a webhook body. Verify the signature first; this only checks shape. */
export function parseWebhookEvent(rawBody: string): WebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new PayPalInputError("Invalid webhook body", ["body is not JSON"]);
  }
  const parsed = webhookEventSchema.safeParse(json);
  if (!parsed.success) throw new PayPalInputError("Invalid webhook event", formatIssues(parsed.error));
  const event = parsed.data;
  return {
    id: event.id,
    eventType: event.event_type,
    resourceType: event.resource_type,
    resource: event.resource,
    createTime: event.create_time,
    summary: event.summary,
    raw: event,
  };
}
