import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthAssertion } from "./auth-assertion";
import { encodeId, paypalRequest } from "./client";
import { PayPalApiError, PayPalInputError } from "./errors";
import { jsonResponse, mockPayPal, resetPayPalTestState, stubPayPalEnv, TEST_ACCESS_TOKEN } from "./test-utils";

beforeEach(() => stubPayPalEnv());
afterEach(resetPayPalTestState);

describe("paypalRequest headers", () => {
  it("always sends bearer token, JSON content type and the BN code", async () => {
    const mock = mockPayPal(() => jsonResponse(200, { ok: true }));
    const result = await paypalRequest<{ ok: boolean }>({ method: "POST", path: "/v2/thing", body: { a: 1 } });
    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    const [call] = mock.apiCalls();
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/thing");
    expect(call.headers.authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers["paypal-partner-attribution-id"]).toBe("TEST_BN_CODE");
    expect(call.json).toEqual({ a: 1 });
  });

  it("omits PayPal-Request-Id, PayPal-Auth-Assertion and Prefer unless asked", async () => {
    const mock = mockPayPal(() => jsonResponse(200, {}));
    await paypalRequest({ method: "GET", path: "/v2/thing" });
    const [call] = mock.apiCalls();
    expect(call.headers).not.toHaveProperty("paypal-request-id");
    expect(call.headers).not.toHaveProperty("paypal-auth-assertion");
    expect(call.headers).not.toHaveProperty("prefer");
    expect(call.body).toBeUndefined();
  });

  it("adds PayPal-Request-Id, the seller's auth assertion and Prefer when given", async () => {
    const mock = mockPayPal(() => jsonResponse(201, {}));
    await paypalRequest({
      method: "POST",
      path: "/v2/thing",
      body: {},
      requestId: "req-123",
      asMerchant: "SELLERAAA111",
      prefer: "return=representation",
    });
    const [call] = mock.apiCalls();
    expect(call.headers["paypal-request-id"]).toBe("req-123");
    expect(call.headers["paypal-auth-assertion"]).toBe(buildAuthAssertion("test-client-id", "SELLERAAA111"));
    expect(call.headers.prefer).toBe("return=representation");
  });

  it("sends rawBody byte for byte and encodes query params", async () => {
    const mock = mockPayPal(() => jsonResponse(200, {}));
    await paypalRequest({ method: "POST", path: "/v1/x", rawBody: '{"n":1.10}', query: { tracking_id: "a b&c" } });
    const [call] = mock.apiCalls();
    expect(call.body).toBe('{"n":1.10}');
    expect(call.search.get("tracking_id")).toBe("a b&c");
  });

  it("refuses paths that are relative or leave the sandbox host", async () => {
    mockPayPal(() => jsonResponse(200, {}));
    await expect(paypalRequest({ method: "GET", path: "v2/x" })).rejects.toThrow(/must start/);
    await expect(paypalRequest({ method: "GET", path: "//evil.example/x" })).rejects.toThrow(/sandbox host/);
  });
});

describe("paypalRequest statuses and errors", () => {
  it("throws PayPalApiError carrying status, name, message, debug_id and details", async () => {
    mockPayPal(() =>
      jsonResponse(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
        debug_id: "f0e1d2c3b4a59",
        details: [{ issue: "ORDER_NOT_APPROVED", description: "Payer has not yet approved the Order for payment." }],
      }),
    );
    const error = await paypalRequest({ method: "POST", path: "/v2/checkout/orders/X/capture", body: {} }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PayPalApiError);
    const apiError = error as PayPalApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.paypalName).toBe("UNPROCESSABLE_ENTITY");
    expect(apiError.debugId).toBe("f0e1d2c3b4a59");
    expect(apiError.issues).toEqual(["ORDER_NOT_APPROVED"]);
    expect(apiError.details[0].description).toMatch(/not yet approved/);
    expect(apiError.method).toBe("POST");
    expect(apiError.path).toBe("/v2/checkout/orders/X/capture");
  });

  it("falls back to the paypal-debug-id header and an HTTP_<status> name for non-JSON bodies", async () => {
    mockPayPal(() => new Response("<html>bad gateway</html>", { status: 502, headers: { "paypal-debug-id": "hdr-debug" } }));
    const error = (await paypalRequest({ method: "GET", path: "/v2/x" }).catch((caught: unknown) => caught)) as PayPalApiError;
    expect(error.paypalName).toBe("HTTP_502");
    expect(error.debugId).toBe("hdr-debug");
  });

  it("returns statuses listed in expectStatuses instead of throwing", async () => {
    mockPayPal(() => jsonResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "no", debug_id: "d" }));
    const result = await paypalRequest({ method: "POST", path: "/v2/x", expectStatuses: [201, 422] });
    expect(result.status).toBe(422);
  });

  it("drops the cached token and retries once on 401", async () => {
    let calls = 0;
    const mock = mockPayPal(() => {
      calls += 1;
      return calls === 1
        ? jsonResponse(401, { name: "AUTHENTICATION_FAILURE", message: "expired", debug_id: "a" })
        : jsonResponse(200, { ok: true });
    });
    const result = await paypalRequest({ method: "GET", path: "/v2/x" });
    expect(result.status).toBe(200);
    expect(mock.calls.filter((call) => call.path === "/v1/oauth2/token")).toHaveLength(2);
    expect(mock.apiCalls()).toHaveLength(2);
  });

  it("throws after a second 401", async () => {
    mockPayPal(() => jsonResponse(401, { name: "AUTHENTICATION_FAILURE", message: "nope", debug_id: "b" }));
    await expect(paypalRequest({ method: "GET", path: "/v2/x" })).rejects.toMatchObject({ status: 401 });
  });
});

describe("encodeId", () => {
  it("encodes path segments and rejects blanks", () => {
    expect(encodeId("5O1/../x")).toBe("5O1%2F..%2Fx");
    expect(() => encodeId(" ")).toThrow(PayPalInputError);
  });
});
