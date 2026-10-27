import { afterEach, describe, expect, it } from "vitest";
import { getPayPalConfig, PAYPAL_SANDBOX_BASE_URL } from "./config";
import { resetPayPalTestState, stubPayPalEnv } from "./test-utils";

afterEach(resetPayPalTestState);

describe("getPayPalConfig", () => {
  it("returns the sandbox base URL and env values", () => {
    stubPayPalEnv();
    const config = getPayPalConfig();
    expect(config.baseUrl).toBe("https://api-m.sandbox.paypal.com");
    expect(PAYPAL_SANDBOX_BASE_URL).toBe("https://api-m.sandbox.paypal.com");
    expect(config.bnCode).toBe("TEST_BN_CODE");
    expect(config.partnerMerchantId).toBe("PARTNER123");
    expect(config.webhookId).toBe("WH-TEST-0001");
  });

  it("throws unless PAYPAL_ENV is sandbox", () => {
    stubPayPalEnv({ PAYPAL_ENV: "live" });
    expect(() => getPayPalConfig()).toThrow(/sandbox/);
  });
});
