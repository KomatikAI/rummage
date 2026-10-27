import { getPayPalConfig } from "./config";
import { toPayPalApiError } from "./errors";
import { getPayPalFetch, type FetchLike } from "./fetch";
import type { TokenResponse } from "./types";

/** Refresh this long before PayPal's stated expiry. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cached: CachedToken | undefined;
let inFlight: Promise<string> | undefined;

export interface GetAccessTokenOptions {
  /** Overrides the module fetch (see setPayPalFetch). */
  fetch?: FetchLike;
  /** Skip the cache and fetch a new token. */
  forceRefresh?: boolean;
}

/**
 * Returns a client-credentials access token, cached in this module until 60 s
 * before it expires. Concurrent callers share one in-flight request.
 */
export async function getAccessToken(options: GetAccessTokenOptions = {}): Promise<string> {
  if (!options.forceRefresh && cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }
  if (!inFlight) {
    inFlight = requestToken(options.fetch ?? getPayPalFetch()).finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

async function requestToken(fetchImpl: FetchLike): Promise<string> {
  const config = getPayPalConfig();
  const path = "/v1/oauth2/token";
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw toPayPalApiError({
      status: response.status,
      body,
      method: "POST",
      path,
      debugIdHeader: response.headers.get("paypal-debug-id"),
    });
  }
  const token = body as Partial<TokenResponse> | undefined;
  if (!token || typeof token.access_token !== "string" || typeof token.expires_in !== "number") {
    throw new Error("PayPal token response is missing access_token or expires_in");
  }
  cached = { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

/** Drops the cached token (after a 401, and in tests). */
export function resetTokenCache(): void {
  cached = undefined;
  inFlight = undefined;
}
