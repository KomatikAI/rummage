import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPartnerReferral,
  getMerchantIntegration,
  parsePartnerReturn,
  summariseMerchantIntegration,
} from "./partner-referrals";
import { jsonResponse, mockPayPal, resetPayPalTestState, stubPayPalEnv } from "./test-utils";
import type { MerchantIntegrationResponse } from "./types";

beforeEach(() => stubPayPalEnv());
afterEach(resetPayPalTestState);

const ACTION_URL =
  "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=NjUxNGVlZjMtZjM4Ny00ZTdmLWI0ZTUtZDQ2ODg3MjQ4ZDE3";
const SELF_URL =
  "https://api.sandbox.paypal.com/v2/customer/partner-referrals/NjUxNGVlZjMtZjM4Ny00ZTdmLWI0ZTUtZDQ2ODg3MjQ4ZDE3";

describe("createPartnerReferral", () => {
  it("sends the THIRD_PARTY PAYMENT+REFUND body and extracts action_url and self", async () => {
    const mock = mockPayPal(() =>
      jsonResponse(201, {
        links: [
          { href: SELF_URL, rel: "self", method: "GET", description: "Read Referral Data shared by the Caller." },
          { href: ACTION_URL, rel: "action_url", method: "GET", description: "Target WEB REDIRECT URL for the next action." },
        ],
      }),
    );
    const referral = await createPartnerReferral({
      trackingId: "seller-42",
      returnUrl: "http://localhost:3000/sell/paypal/return",
      logoUrl: "http://localhost:3000/logo.png",
    });
    expect(referral).toMatchObject({ actionUrl: ACTION_URL, selfUrl: SELF_URL });

    const [call] = mock.apiCalls();
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/v2/customer/partner-referrals");
    expect(call.headers["paypal-partner-attribution-id"]).toBe("TEST_BN_CODE");
    expect(call.json).toEqual({
      tracking_id: "seller-42",
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: ["PAYMENT", "REFUND"] },
            },
          },
        },
      ],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      partner_config_override: {
        return_url: "http://localhost:3000/sell/paypal/return",
        partner_logo_url: "http://localhost:3000/logo.png",
      },
    });
  });

  it("omits partner_logo_url when no logo is given", async () => {
    const mock = mockPayPal(() => jsonResponse(201, { links: [{ href: ACTION_URL, rel: "action_url" }] }));
    const referral = await createPartnerReferral({ trackingId: "seller-43", returnUrl: "http://localhost:3000/r" });
    expect(referral.selfUrl).toBeUndefined();
    expect(mock.apiCalls()[0].json).toMatchObject({ partner_config_override: { return_url: "http://localhost:3000/r" } });
    expect(JSON.stringify(mock.apiCalls()[0].json)).not.toContain("partner_logo_url");
  });

  it("throws when PayPal returns no action_url", async () => {
    mockPayPal(() => jsonResponse(201, { links: [{ href: SELF_URL, rel: "self" }] }));
    await expect(createPartnerReferral({ trackingId: "s", returnUrl: "http://localhost:3000/r" })).rejects.toThrow(
      /action_url/,
    );
  });
});

describe("parsePartnerReturn", () => {
  it("turns PayPal's string params into a typed object with real booleans", () => {
    const params = new URLSearchParams(
      "merchantId=seller-42&merchantIdInPayPal=SELLERAAA111&permissionsGranted=true&accountStatus=BUSINESS_ACCOUNT" +
        "&consentStatus=true&productIntentId=addipmt&isEmailConfirmed=false&riskStatus=SUBSCRIBED_WITH_ALL_FEATURES",
    );
    expect(parsePartnerReturn(params)).toEqual({
      trackingId: "seller-42",
      merchantIdInPayPal: "SELLERAAA111",
      permissionsGranted: true,
      consentStatus: true,
      isEmailConfirmed: false,
      productIntentId: "addipmt",
      accountStatus: "BUSINESS_ACCOUNT",
      riskStatus: "SUBSCRIBED_WITH_ALL_FEATURES",
    });
  });

  it("treats missing, empty or odd values as false / undefined", () => {
    const parsed = parsePartnerReturn(new URLSearchParams("merchantId=&permissionsGranted=yes&consentStatus=TRUE"));
    expect(parsed).toMatchObject({
      trackingId: undefined,
      merchantIdInPayPal: undefined,
      permissionsGranted: false,
      consentStatus: true,
      isEmailConfirmed: false,
    });
  });
});

const readySeller: MerchantIntegrationResponse = {
  merchant_id: "SELLERAAA111",
  tracking_id: "seller-42",
  products: [{ name: "EXPRESS_CHECKOUT", status: "ACTIVE" }],
  payments_receivable: true,
  primary_email_confirmed: true,
  oauth_integrations: [
    {
      integration_type: "OAUTH_THIRD_PARTY",
      integration_method: "PAYPAL",
      oauth_third_party: [
        {
          partner_client_id: "partner-client",
          merchant_client_id: "merchant-client",
          scopes: [
            "https://uri.paypal.com/services/payments/realtimepayment",
            "https://uri.paypal.com/services/payments/refund",
            "https://uri.paypal.com/services/payments/payment/authcapture",
          ],
        },
      ],
    },
  ],
};

describe("summariseMerchantIntegration", () => {
  it("is ready when receivable, email confirmed, and payment + refund scopes are granted", () => {
    expect(summariseMerchantIntegration(readySeller)).toMatchObject({
      merchantId: "SELLERAAA111",
      trackingId: "seller-42",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
      hasPaymentScope: true,
      hasRefundScope: true,
      readyToSell: true,
    });
  });

  it.each([
    ["payments not receivable", { ...readySeller, payments_receivable: false }, "paymentsReceivable"],
    ["email unconfirmed", { ...readySeller, primary_email_confirmed: false }, "primaryEmailConfirmed"],
    ["email flag missing", { ...readySeller, primary_email_confirmed: undefined }, "primaryEmailConfirmed"],
  ] as const)("is not ready when %s", (_label, raw, flag) => {
    const status = summariseMerchantIntegration(raw);
    expect(status[flag]).toBe(false);
    expect(status.readyToSell).toBe(false);
  });

  it("does not count the refund scope as a payment scope", () => {
    const refundOnly = structuredClone(readySeller);
    refundOnly.oauth_integrations = [
      { oauth_third_party: [{ scopes: ["https://uri.paypal.com/services/payments/refund"] }] },
    ];
    expect(summariseMerchantIntegration(refundOnly)).toMatchObject({
      hasPaymentScope: false,
      hasRefundScope: true,
      readyToSell: false,
    });
  });

  it("is not ready without a refund scope or with no oauth integrations", () => {
    const paymentOnly = structuredClone(readySeller);
    paymentOnly.oauth_integrations = [
      { oauth_third_party: [{ scopes: ["https://uri.paypal.com/services/payments/realtimepayment"] }] },
    ];
    expect(summariseMerchantIntegration(paymentOnly)).toMatchObject({ hasPaymentScope: true, hasRefundScope: false, readyToSell: false });
    expect(summariseMerchantIntegration({ ...readySeller, oauth_integrations: undefined }).readyToSell).toBe(false);
  });
});

describe("getMerchantIntegration", () => {
  it("looks up by PayPal merchant id under the partner", async () => {
    const mock = mockPayPal(() => jsonResponse(200, readySeller));
    const status = await getMerchantIntegration({ merchantIdInPayPal: "SELLERAAA111" });
    expect(status.readyToSell).toBe(true);
    const [call] = mock.apiCalls();
    expect(call.method).toBe("GET");
    expect(call.path).toBe("/v1/customer/partners/PARTNER123/merchant-integrations/SELLERAAA111");
    expect(call.headers).not.toHaveProperty("paypal-auth-assertion");
  });

  it("by tracking id: uses the result directly when it carries status fields", async () => {
    const mock = mockPayPal(() => jsonResponse(200, readySeller));
    const status = await getMerchantIntegration({ trackingId: "seller-42" });
    expect(status.readyToSell).toBe(true);
    const [call] = mock.apiCalls();
    expect(call.path).toBe("/v1/customer/partners/PARTNER123/merchant-integrations");
    expect(call.search.get("tracking_id")).toBe("seller-42");
    expect(mock.apiCalls()).toHaveLength(1);
  });

  it("by tracking id: follows up by merchant id when the lookup returns only ids and links", async () => {
    const mock = mockPayPal((call) =>
      call.path.endsWith("/merchant-integrations")
        ? jsonResponse(200, {
            merchant_id: "SELLERAAA111",
            tracking_id: "seller-42",
            links: [
              {
                href: "https://api.sandbox.paypal.com/v1/customer/partners/PARTNER123/merchant-integrations/SELLERAAA111",
                rel: "read",
                method: "GET",
              },
            ],
          })
        : jsonResponse(200, { ...readySeller, tracking_id: undefined }),
    );
    const status = await getMerchantIntegration({ trackingId: "seller-42" });
    expect(mock.apiCalls().map((call) => call.path)).toEqual([
      "/v1/customer/partners/PARTNER123/merchant-integrations",
      "/v1/customer/partners/PARTNER123/merchant-integrations/SELLERAAA111",
    ]);
    expect(status).toMatchObject({ merchantId: "SELLERAAA111", trackingId: "seller-42", readyToSell: true });
  });
});
