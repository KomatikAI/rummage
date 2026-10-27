import { onboardingStatusFor, type OnboardingStatus } from "@/lib/checkout/onboarding";
import { getMerchantIntegration } from "@/lib/paypal";
import type { RummageClient } from "@/lib/supabase/server";

/**
 * Organizer onboarding for a fundraiser sale: the PayPal account that receives the
 * donation unit at checkout. It mirrors lane E's household onboarding
 * (lib/checkout/onboarding.ts), with one difference forced by the schema: `sales` has
 * no readiness columns, and a non-null `organizer_merchant_id` is what turns donations
 * on at checkout (public_sales.accepts_donations, buildCheckoutUnits). So the merchant
 * id is stored only once PayPal confirms the account can receive payments and its
 * email is confirmed; a pending account is not stored and the organizer links again.
 */

/**
 * The referral tracking id for a sale. Prefixed so it can never equal a household's
 * tracking_id (a bare uuid), which the onboarding webhook matches on.
 */
export function organizerTrackingId(saleId: string): string {
  return `sale-${saleId}`;
}

export type OrganizerRefreshResult =
  | { kind: "updated"; status: OnboardingStatus; stored: boolean }
  | { kind: "tracking_mismatch" }
  | { kind: "db_error"; code: string | undefined };

/**
 * Re-reads the merchant from PayPal (never trusting browser params), checks the
 * integration was made for this sale, and stores the merchant id when it is ready.
 * PayPal errors propagate to the caller.
 */
export async function refreshOrganizerOnboarding(
  admin: RummageClient,
  sale: { id: string },
  merchantIdInPayPal: string,
): Promise<OrganizerRefreshResult> {
  const integration = await getMerchantIntegration({ merchantIdInPayPal });
  if (integration.trackingId !== undefined && integration.trackingId !== organizerTrackingId(sale.id)) {
    return { kind: "tracking_mismatch" };
  }
  const status = onboardingStatusFor(integration);
  if (status !== "ready") return { kind: "updated", status, stored: false };

  const { error } = await admin
    .from("sales")
    .update({ organizer_merchant_id: merchantIdInPayPal })
    .eq("id", sale.id);
  if (error) return { kind: "db_error", code: error.code };
  return { kind: "updated", status, stored: true };
}
