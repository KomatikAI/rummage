import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayPalApiError } from "./errors";
import { jsonResponse, mockPayPal, resetPayPalTestState, stubPayPalEnv } from "./test-utils";
import { getAccessToken, resetTokenCache, TOKEN_REFRESH_MARGIN_MS } from "./token";

beforeEach(() => {
  stubPayPalEnv();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  resetPayPalTestState();
});

function tokenServer(expiresIn = 3600) {
  let issued = 0;
  const mock = mockPayPal(
    () => {
      issued += 1;
      return jsonResponse(200, { access_token: `token-${issued}`, token_type: "Bearer", expires_in: expiresIn });
    },
    { handleToken: true },
  );
  return mock;
}

describe("getAccessToken", () => {
  it("posts client credentials with basic auth", async () => {
    const { calls } = tokenServer();
    await expect(getAccessToken()).resolves.toBe("token-1");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(call.method).toBe("POST");
    expect(call.body).toBe("grant_type=client_credentials");
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const expected = Buffer.from("test-client-id:test-client-secret").toString("base64");
    expect(call.headers.authorization).toBe(`Basic ${expected}`);
  });

  it("caches the token until 60 s before expiry, then refreshes", async () => {
    const { calls } = tokenServer(3600);
    expect(await getAccessToken()).toBe("token-1");
    vi.advanceTimersByTime(3600_000 - TOKEN_REFRESH_MARGIN_MS - 1);
    expect(await getAccessToken()).toBe("token-1");
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(await getAccessToken()).toBe("token-2");
    expect(calls).toHaveLength(2);
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    const { calls } = tokenServer();
    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    expect(tokens).toEqual(["token-1", "token-1", "token-1"]);
    expect(calls).toHaveLength(1);
  });

  it("forceRefresh and resetTokenCache bypass the cache", async () => {
    const { calls } = tokenServer();
    await getAccessToken();
    expect(await getAccessToken({ forceRefresh: true })).toBe("token-2");
    resetTokenCache();
    expect(await getAccessToken()).toBe("token-3");
    expect(calls).toHaveLength(3);
  });

  it("accepts an injected fetch", async () => {
    const injected = vi.fn(async () => jsonResponse(200, { access_token: "injected", expires_in: 100 }));
    await expect(getAccessToken({ fetch: injected })).resolves.toBe("injected");
    expect(injected).toHaveBeenCalledOnce();
  });

  it("throws PayPalApiError on an OAuth error and does not cache it", async () => {
    let first = true;
    mockPayPal(
      () => {
        if (first) {
          first = false;
          return jsonResponse(401, { error: "invalid_client", error_description: "Client Authentication failed" });
        }
        return jsonResponse(200, { access_token: "after-error", expires_in: 3600 });
      },
      { handleToken: true },
    );
    const error = await getAccessToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({ status: 401, paypalName: "invalid_client", message: "Client Authentication failed" });
    await expect(getAccessToken()).resolves.toBe("after-error");
  });
});
