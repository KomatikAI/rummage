import { env } from "@/lib/env";

/** The only PayPal host Rummage ever talks to. */
export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface PayPalConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  bnCode: string;
  partnerMerchantId: string;
  webhookId: string;
}

/**
 * Reads PayPal settings through the validated `env` getter. Throws unless
 * PAYPAL_ENV is exactly "sandbox" (lib/env.ts already refuses anything else;
 * this check is a second lock right next to the base URL).
 */
export function getPayPalConfig(): PayPalConfig {
  const mode: string = env.PAYPAL_ENV;
  if (mode !== "sandbox") {
    throw new Error(`PAYPAL_ENV must be "sandbox"; got "${mode}". Rummage never calls live PayPal.`);
  }
  return {
    baseUrl: PAYPAL_SANDBOX_BASE_URL,
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    bnCode: env.PAYPAL_BN_CODE,
    partnerMerchantId: env.PAYPAL_PARTNER_MERCHANT_ID,
    webhookId: env.PAYPAL_WEBHOOK_ID,
  };
}
