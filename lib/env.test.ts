import { afterEach, describe, expect, it, vi } from "vitest";
import { env, getEnv, parseServerEnv, resetEnvCache } from "./env";

const validEnv = {
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "test-client-id",
  PAYPAL_CLIENT_SECRET: "test-client-secret",
  PAYPAL_BN_CODE: "TEST_BN_CODE",
  PAYPAL_PARTNER_MERCHANT_ID: "TESTMERCHANT",
  PAYPAL_WEBHOOK_ID: "test-webhook-id",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "test-client-id",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  APP_URL: "http://localhost:3000",
};

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("parseServerEnv", () => {
  it("accepts a complete sandbox env", () => {
    const parsed = parseServerEnv(validEnv);
    expect(parsed.PAYPAL_ENV).toBe("sandbox");
    expect(parsed.APP_URL).toBe("http://localhost:3000");
  });

  it("throws naming the missing variable", () => {
    const { PAYPAL_CLIENT_SECRET: _omitted, ...rest } = validEnv;
    void _omitted;
    expect(() => parseServerEnv(rest)).toThrow(/PAYPAL_CLIENT_SECRET is required/);
  });

  it("throws on an empty value", () => {
    expect(() => parseServerEnv({ ...validEnv, ANTHROPIC_API_KEY: "" })).toThrow(
      /ANTHROPIC_API_KEY is required/,
    );
  });

  it("refuses PAYPAL_ENV=live", () => {
    expect(() => parseServerEnv({ ...validEnv, PAYPAL_ENV: "live" })).toThrow(
      /PAYPAL_ENV must be "sandbox"/,
    );
  });
});

describe("env getter", () => {
  it("loads lazily from process.env and caches", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    expect(env.PAYPAL_BN_CODE).toBe("TEST_BN_CODE");
    vi.stubEnv("PAYPAL_BN_CODE", "CHANGED");
    expect(getEnv().PAYPAL_BN_CODE).toBe("TEST_BN_CODE");
  });

  it("throws on first access when PAYPAL_ENV is live", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    vi.stubEnv("PAYPAL_ENV", "live");
    expect(() => env.PAYPAL_CLIENT_ID).toThrow(/sandbox/);
  });
});
