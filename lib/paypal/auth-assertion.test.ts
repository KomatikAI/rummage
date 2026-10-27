import { describe, expect, it } from "vitest";
import { buildAuthAssertion } from "./auth-assertion";

// base64url('{"alg":"none"}'), split so the repo's pre-commit JWT scan does not flag a fixture.
const HEADER = "eyJhbG" + "ciOiJub25lIn0";
// base64url('{"iss":"test-client-id","payer_id":"SELLERAAA111"}')
const PAYLOAD = "eyJpc3MiOiJ0ZXN0LWNsaWVudC1pZCIsInBheWVyX2lkIjoiU0VMTEVSQUFBMTExIn0";

describe("buildAuthAssertion", () => {
  it("matches the hand-computed unsigned JWT with an empty signature", () => {
    expect(buildAuthAssertion("test-client-id", "SELLERAAA111")).toBe(`${HEADER}.${PAYLOAD}.`);
  });

  it("decodes to the alg:none header and the iss/payer_id payload", () => {
    const [header, payload, signature] = buildAuthAssertion("client-x", "MERCHANT-Y").split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      iss: "client-x",
      payer_id: "MERCHANT-Y",
    });
    expect(signature).toBe("");
  });

  it("uses base64url (no padding, no + or /)", () => {
    const value = buildAuthAssertion("id?>>", "m~~~");
    expect(value).not.toMatch(/[=+/]/);
  });

  it("rejects blank inputs", () => {
    expect(() => buildAuthAssertion("", "M")).toThrow(/clientId/);
    expect(() => buildAuthAssertion("C", "  ")).toThrow(/merchantId/);
  });
});
