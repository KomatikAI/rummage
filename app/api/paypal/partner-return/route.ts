import { z } from "zod";

import { appBaseUrl, databaseError, jsonError, paypalErrorResponse, unauthorized } from "@/lib/checkout/http";
import { refreshHouseholdOnboarding, type RefreshResult } from "@/lib/checkout/onboarding";
import { getSignedInUserId } from "@/lib/checkout/session";
import { env } from "@/lib/env";
import { parsePartnerReturn } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const householdIdSchema = z.uuid();
const merchantIdSchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/, "must be a PayPal merchant id");

/**
 * GET /api/paypal/partner-return?householdId=...&merchantIdInPayPal=...
 * PayPal sends the seller here after sign-up. The query comes through the browser,
 * so readiness is re-read from PayPal before it is stored. Redirects (303) to
 * /seller?household=<id>&onboarding=<ready|pending>.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const householdId = householdIdSchema.safeParse(params.get("householdId"));
  if (!householdId.success) return jsonError(400, "invalid_household", "householdId must be a uuid.");

  const returned = parsePartnerReturn(params);
  const merchantId = merchantIdSchema.safeParse(returned.merchantIdInPayPal);
  if (!merchantId.success) {
    return jsonError(400, "missing_merchant_id", "PayPal did not return a merchant id. Try linking again.");
  }

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const household = await admin
    .from("households")
    .select("id, owner_user_id, tracking_id")
    .eq("id", householdId.data)
    .maybeSingle();
  if (household.error) return databaseError("load household", household.error);
  if (!household.data) return jsonError(404, "household_not_found", "No such household.");
  if (household.data.owner_user_id !== userId) {
    return jsonError(403, "forbidden", "This household belongs to someone else.");
  }
  // PayPal echoes our tracking id as `merchantId`; when present it must be this household's.
  if (returned.trackingId !== undefined && returned.trackingId !== household.data.tracking_id) {
    return jsonError(400, "tracking_mismatch", "This PayPal return is for a different household.");
  }

  let refreshed: RefreshResult;
  try {
    refreshed = await refreshHouseholdOnboarding(admin, household.data, merchantId.data);
  } catch (error) {
    const mapped = paypalErrorResponse(error, "partner-return");
    if (mapped) return mapped;
    throw error;
  }
  if (refreshed.kind === "tracking_mismatch") {
    return jsonError(403, "tracking_mismatch", "That PayPal account was linked for a different household.");
  }
  if (refreshed.kind === "db_error") return databaseError("store onboarding", { code: refreshed.code });

  const target = new URL(`${appBaseUrl(env.APP_URL)}/seller`);
  target.searchParams.set("household", household.data.id);
  target.searchParams.set("onboarding", refreshed.status);
  return Response.redirect(target.toString(), 303);
}
