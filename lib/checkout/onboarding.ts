import { getMerchantIntegration } from "@/lib/paypal";
import type { RummageClient } from "@/lib/supabase/server";

/** Seller onboarding: confirm a merchant id with PayPal and store the result on the household. */

export type OnboardingStatus = "ready" | "pending";

/** Ready when PayPal says the account can receive payments and its email is confirmed. */
export function onboardingStatusFor(status: {
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
}): OnboardingStatus {
  return status.paymentsReceivable && status.primaryEmailConfirmed ? "ready" : "pending";
}

export type RefreshResult =
  | { kind: "updated"; status: OnboardingStatus }
  | { kind: "tracking_mismatch" }
  | { kind: "db_error"; code: string | undefined };

/**
 * Looks the merchant up with PayPal (never trusting browser params), checks the
 * integration belongs to this household's tracking id, then stores the merchant id
 * and status. PayPal errors propagate to the caller.
 */
export async function refreshHouseholdOnboarding(
  admin: RummageClient,
  household: { id: string; tracking_id: string },
  merchantIdInPayPal: string,
  now: Date = new Date(),
): Promise<RefreshResult> {
  const integration = await getMerchantIntegration({ merchantIdInPayPal });
  if (integration.trackingId !== undefined && integration.trackingId !== household.tracking_id) {
    return { kind: "tracking_mismatch" };
  }
  const status = onboardingStatusFor(integration);
  const { error } = await admin
    .from("households")
    .update({
      merchant_id_in_paypal: merchantIdInPayPal,
      paypal_status: status,
      paypal_checked_at: now.toISOString(),
    })
    .eq("id", household.id);
  if (error) return { kind: "db_error", code: error.code };
  return { kind: "updated", status };
}
