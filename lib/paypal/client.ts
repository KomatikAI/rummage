import { buildAuthAssertion } from "./auth-assertion";
import { getPayPalConfig } from "./config";
import { PayPalInputError, toPayPalApiError } from "./errors";
import { getPayPalFetch } from "./fetch";
import { getAccessToken, resetTokenCache } from "./token";
import type { HttpMethod } from "./types";

export interface PayPalRequestOptions {
  method: HttpMethod;
  /** Path beginning with "/", e.g. "/v2/checkout/orders". */
  path: string;
  /** JSON-serialised into the request body. */
  body?: unknown;
  /**
   * A pre-serialised JSON body, sent byte for byte. Used by webhook
   * verification so the event is not re-serialised.
   */
  rawBody?: string;
  /** Query string parameters. */
  query?: Record<string, string>;
  /** Sent as PayPal-Request-Id (idempotency key). */
  requestId?: string;
  /** Seller merchant id: adds PayPal-Auth-Assertion to act on that seller's behalf. */
  asMerchant?: string;
  /** Sent as the Prefer header, e.g. "return=representation". */
  prefer?: string;
  /** Statuses returned instead of thrown. Defaults to any 2xx. */
  expectStatuses?: readonly number[];
}

export interface PayPalResponse<T> {
  status: number;
  body: T;
  debugId: string | undefined;
}

/**
 * One PayPal REST call. Adds Authorization, Content-Type, the BN code
 * (PayPal-Partner-Attribution-Id), and when asked PayPal-Request-Id,
 * PayPal-Auth-Assertion and Prefer. A 401 drops the cached token and retries
 * once. Any status outside `expectStatuses` throws PayPalApiError.
 */
export async function paypalRequest<T>(options: PayPalRequestOptions): Promise<PayPalResponse<T>> {
  const first = await send(options, false);
  if (first.status === 401) {
    resetTokenCache();
    return finish<T>(options, await send(options, true));
  }
  return finish<T>(options, first);
}

async function send(options: PayPalRequestOptions, forceRefresh: boolean): Promise<Response> {
  const config = getPayPalConfig();
  const token = await getAccessToken({ forceRefresh });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "PayPal-Partner-Attribution-Id": config.bnCode,
  };
  if (options.requestId) headers["PayPal-Request-Id"] = options.requestId;
  if (options.asMerchant) headers["PayPal-Auth-Assertion"] = buildAuthAssertion(config.clientId, options.asMerchant);
  if (options.prefer) headers.Prefer = options.prefer;

  let body: string | undefined;
  if (options.rawBody !== undefined) body = options.rawBody;
  else if (options.body !== undefined) body = JSON.stringify(options.body);

  return getPayPalFetch()(buildUrl(config.baseUrl, options.path, options.query), {
    method: options.method,
    headers,
    body,
  });
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
  if (!path.startsWith("/")) throw new Error(`PayPal path must start with "/": ${path}`);
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl) throw new Error(`PayPal path escapes the sandbox host: ${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

async function finish<T>(options: PayPalRequestOptions, response: Response): Promise<PayPalResponse<T>> {
  const text = await response.text();
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  const debugId = response.headers.get("paypal-debug-id") ?? undefined;
  const expected = options.expectStatuses
    ? options.expectStatuses.includes(response.status)
    : response.status >= 200 && response.status < 300;
  if (!expected) {
    throw toPayPalApiError({
      status: response.status,
      body: parsed,
      method: options.method,
      path: options.path,
      debugIdHeader: debugId,
    });
  }
  return { status: response.status, body: parsed as T, debugId };
}

/** The href of the first link with this rel, if any. */
export function findLink(links: ReadonlyArray<{ rel: string; href: string }> | undefined, rel: string): string | undefined {
  return links?.find((link) => link.rel === rel)?.href;
}

/** URL-encodes one path segment (order, capture, refund id); rejects blanks. */
export function encodeId(id: string): string {
  if (!id.trim()) throw new PayPalInputError("Invalid id", ["id is required"]);
  return encodeURIComponent(id);
}
