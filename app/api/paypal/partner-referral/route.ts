import { z } from "zod";

import {
  appBaseUrl,
  databaseError,
  jsonError,
  paypalErrorResponse,
  readJsonBody,
  unauthorized,
} from "@/lib/checkout/http";
import { getSignedInUserId } from "@/lib/checkout/session";
import { env } from "@/lib/env";
import { createPartnerReferral, type PartnerReferral } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({ householdId: z.uuid() });

/**
 * POST { householdId } -> { actionUrl }
 * A fresh, single-use PayPal sign-up link for the seller who owns the household.
 * The household's own tracking_id (a uuid set at creation) is the referral tracking
 * id, so PayPal's return and webhooks can be matched back to it.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if (!body.ok) return body.response;
  const { householdId } = body.data;

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const household = await admin
    .from("households")
    .select("id, owner_user_id, tracking_id")
    .eq("id", householdId)
    .maybeSingle();
  if (household.error) return databaseError("load household", household.error);
  if (!household.data) return jsonError(404, "household_not_found", "No such household.");
  if (household.data.owner_user_id !== userId) {
    return jsonError(403, "forbidden", "Only the household's owner can link PayPal.");
  }

  const returnUrl = `${appBaseUrl(env.APP_URL)}/api/paypal/partner-return?householdId=${encodeURIComponent(householdId)}`;
  let referral: PartnerReferral;
  try {
    referral = await createPartnerReferral({ trackingId: household.data.tracking_id, returnUrl });
  } catch (error) {
    const mapped = paypalErrorResponse(error, "partner-referral");
    if (mapped) return mapped;
    throw error;
  }

  return Response.json({ actionUrl: referral.actionUrl });
}
