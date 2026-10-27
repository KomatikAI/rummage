import { z } from "zod";
import { encodeId, findLink, paypalRequest } from "./client";
import { getPayPalConfig } from "./config";
import { PayPalInputError } from "./errors";
import { formatIssues } from "./money";
import type { MerchantIntegrationResponse, PartnerReferralRequest, PartnerReferralResponse } from "./types";

const referralInputSchema = z.object({
  /** Our id for the seller; PayPal echoes it back as `merchantId` on the return URL. */
  trackingId: z.string().trim().min(1).max(127),
  returnUrl: z.url(),
  logoUrl: z.url().optional(),
  requestId: z.string().trim().min(1).max(108).optional(),
});

export type CreatePartnerReferralInput = z.input<typeof referralInputSchema>;

export interface PartnerReferral {
  /** Single-use seller sign-up URL (rel "action_url"). */
  actionUrl: string;
  /** The referral resource (rel "self"). */
  selfUrl: string | undefined;
  raw: PartnerReferralResponse;
}

export function buildPartnerReferralBody(input: z.output<typeof referralInputSchema>): PartnerReferralRequest {
  return {
    tracking_id: input.trackingId,
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
      return_url: input.returnUrl,
      ...(input.logoUrl !== undefined ? { partner_logo_url: input.logoUrl } : {}),
    },
  };
}

/** Creates a seller sign-up link with PAYMENT and REFUND permissions. */
export async function createPartnerReferral(input: CreatePartnerReferralInput): Promise<PartnerReferral> {
  const parsed = referralInputSchema.safeParse(input);
  if (!parsed.success) throw new PayPalInputError("Invalid partner referral", formatIssues(parsed.error));
  const response = await paypalRequest<PartnerReferralResponse>({
    method: "POST",
    path: "/v2/customer/partner-referrals",
    body: buildPartnerReferralBody(parsed.data),
    requestId: parsed.data.requestId,
  });
  const actionUrl = findLink(response.body.links, "action_url");
  if (!actionUrl) throw new Error("PayPal partner referral response has no action_url link");
  return { actionUrl, selfUrl: findLink(response.body.links, "self"), raw: response.body };
}

// ---------------------------------------------------------------- return URL

export interface PartnerReturn {
  /** PayPal's `merchantId` param: the tracking_id we sent. */
  trackingId: string | undefined;
  /** The seller's PayPal merchant id. */
  merchantIdInPayPal: string | undefined;
  permissionsGranted: boolean;
  consentStatus: boolean;
  isEmailConfirmed: boolean;
  productIntentId: string | undefined;
  accountStatus: string | undefined;
  riskStatus: string | undefined;
}

/**
 * Parses the query PayPal appends to the referral return URL. Booleans arrive
 * as "true"/"false"; anything but "true" (case-insensitive) is false. These
 * values come from the browser and are untrusted: confirm readiness with
 * getMerchantIntegration before letting a seller list items.
 */
export function parsePartnerReturn(searchParams: URLSearchParams): PartnerReturn {
  const text = (key: string): string | undefined => {
    const value = searchParams.get(key)?.trim();
    return value ? value : undefined;
  };
  const flag = (key: string): boolean => text(key)?.toLowerCase() === "true";
  return {
    trackingId: text("merchantId"),
    merchantIdInPayPal: text("merchantIdInPayPal"),
    permissionsGranted: flag("permissionsGranted"),
    consentStatus: flag("consentStatus"),
    isEmailConfirmed: flag("isEmailConfirmed"),
    productIntentId: text("productIntentId"),
    accountStatus: text("accountStatus"),
    riskStatus: text("riskStatus"),
  };
}

// ---------------------------------------------------------------- seller status

export interface MerchantIntegrationStatus {
  merchantId: string | undefined;
  trackingId: string | undefined;
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
  hasPaymentScope: boolean;
  hasRefundScope: boolean;
  /** All four flags above are true. */
  readyToSell: boolean;
  raw: MerchantIntegrationResponse;
}

export type MerchantIntegrationLookup = { merchantIdInPayPal: string } | { trackingId: string };

/** Every oauth_third_party scope granted to us. */
function grantedScopes(raw: MerchantIntegrationResponse): string[] {
  return (raw.oauth_integrations ?? []).flatMap((integration) =>
    (integration.oauth_third_party ?? []).flatMap((party) => party.scopes ?? []),
  );
}

/**
 * Refund scope: ".../payments/refund". Payment scope: any other ".../payments/..."
 * scope (".../payments/realtimepayment", ".../payments/payment/authcapture").
 * The refund scope also contains "/payments/", so it is excluded explicitly.
 */
export function summariseMerchantIntegration(raw: MerchantIntegrationResponse): MerchantIntegrationStatus {
  const scopes = grantedScopes(raw);
  const isRefund = (scope: string) => /\/refund(\/|$)/.test(scope);
  const hasRefundScope = scopes.some(isRefund);
  const hasPaymentScope = scopes.some((scope) => scope.includes("/payments/") && !isRefund(scope));
  const paymentsReceivable = raw.payments_receivable === true;
  const primaryEmailConfirmed = raw.primary_email_confirmed === true;
  return {
    merchantId: raw.merchant_id,
    trackingId: raw.tracking_id,
    paymentsReceivable,
    primaryEmailConfirmed,
    hasPaymentScope,
    hasRefundScope,
    readyToSell: paymentsReceivable && primaryEmailConfirmed && hasPaymentScope && hasRefundScope,
    raw,
  };
}

/**
 * Reads a seller's onboarding status, by PayPal merchant id or by our
 * tracking id. The tracking-id lookup may return only the merchant id (and
 * links); when it lacks the status fields this follows up with the
 * merchant-id call.
 */
export async function getMerchantIntegration(lookup: MerchantIntegrationLookup): Promise<MerchantIntegrationStatus> {
  const partner = encodeId(getPayPalConfig().partnerMerchantId);
  const collection = `/v1/customer/partners/${partner}/merchant-integrations`;

  if ("merchantIdInPayPal" in lookup) {
    const response = await paypalRequest<MerchantIntegrationResponse>({
      method: "GET",
      path: `${collection}/${encodeId(lookup.merchantIdInPayPal)}`,
    });
    return summariseMerchantIntegration(response.body);
  }

  if (!lookup.trackingId.trim()) throw new PayPalInputError("Invalid lookup", ["trackingId is required"]);
  const byTracking = await paypalRequest<MerchantIntegrationResponse>({
    method: "GET",
    path: collection,
    query: { tracking_id: lookup.trackingId },
  });
  const found = byTracking.body;
  const hasStatus = found.payments_receivable !== undefined || found.oauth_integrations !== undefined;
  if (hasStatus || !found.merchant_id) return summariseMerchantIntegration(found);

  const detail = await paypalRequest<MerchantIntegrationResponse>({
    method: "GET",
    path: `${collection}/${encodeId(found.merchant_id)}`,
  });
  return summariseMerchantIntegration({ tracking_id: found.tracking_id, ...detail.body });
}
