/**
 * Shared helpers for lib/paypal tests: a fake sandbox env and a recording
 * fetch mock. No real credentials; nothing here reaches the network.
 */
import { vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { setPayPalFetch } from "./fetch";
import { resetTokenCache } from "./token";

export const TEST_ENV = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "test-client-id",
  PAYPAL_CLIENT_SECRET: "test-client-secret",
  PAYPAL_BN_CODE: "TEST_BN_CODE",
  PAYPAL_PARTNER_MERCHANT_ID: "PARTNER123",
  PAYPAL_WEBHOOK_ID: "WH-TEST-0001",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "test-client-id",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  APP_URL: "http://localhost:3000",
} as const;

export const TEST_ACCESS_TOKEN = "test-access-token";

export function stubPayPalEnv(overrides: Partial<Record<keyof typeof TEST_ENV, string>> = {}): void {
  for (const [key, value] of Object.entries({ ...TEST_ENV, ...overrides })) vi.stubEnv(key, value);
  resetEnvCache();
}

export interface RecordedCall {
  url: string;
  path: string;
  search: URLSearchParams;
  method: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: string | undefined;
  json: unknown;
}

export function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function normaliseHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Installs a fetch mock. The token endpoint answers automatically unless
 * `handleToken` is set; every other call goes to `handler`.
 */
export function mockPayPal(
  handler: (call: RecordedCall) => Response | Promise<Response>,
  options: { handleToken?: boolean } = {},
) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const body = typeof init?.body === "string" ? init.body : undefined;
    let json: unknown;
    try {
      json = body ? JSON.parse(body) : undefined;
    } catch {
      json = undefined;
    }
    const call: RecordedCall = {
      url: input,
      path: url.pathname,
      search: url.searchParams,
      method: init?.method ?? "GET",
      headers: normaliseHeaders(init?.headers),
      body,
      json,
    };
    calls.push(call);
    if (call.path === "/v1/oauth2/token" && !options.handleToken) {
      return jsonResponse(200, { access_token: TEST_ACCESS_TOKEN, token_type: "Bearer", expires_in: 32400 });
    }
    return handler(call);
  });
  setPayPalFetch(fetchMock);
  return {
    calls,
    fetchMock,
    /** Calls other than the token endpoint. */
    apiCalls: () => calls.filter((call) => call.path !== "/v1/oauth2/token"),
  };
}

export function resetPayPalTestState(): void {
  setPayPalFetch(undefined);
  resetTokenCache();
  vi.unstubAllEnvs();
  resetEnvCache();
}
