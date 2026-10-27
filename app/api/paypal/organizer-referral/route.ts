import { z } from "zod";

import { organizerTrackingId } from "@/components/organizer/onboarding";
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

const bodySchema = z.object({ saleId: z.uuid() });

/**
 * POST { saleId } -> { actionUrl }
 * A fresh, single-use PayPal sign-up link for the account that receives a fundraiser
 * sale's donations. Only the sale's organizer may ask, and only for a sale with a
 * fundraiser. The referral tracking id is "sale-<saleId>" so the return can be matched
 * back to the sale (and never to a household).
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, bodySchema);
  if (!body.ok) return body.response;
  const { saleId } = body.data;

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const sale = await admin
    .from("sales")
    .select("id, organizer_user_id, fundraiser_name")
    .eq("id", saleId)
    .maybeSingle();
  if (sale.error) return databaseError("load sale", sale.error);
  if (!sale.data) return jsonError(404, "sale_not_found", "No such sale.");
  if (sale.data.organizer_user_id === null || sale.data.organizer_user_id !== userId) {
    return jsonError(403, "forbidden", "Only the sale's organizer can link PayPal for donations.");
  }
  if (!sale.data.fundraiser_name) {
    return jsonError(409, "no_fundraiser", "This sale has no fundraiser, so there is nothing to link.");
  }

  const returnUrl = `${appBaseUrl(env.APP_URL)}/api/paypal/organizer-return?saleId=${encodeURIComponent(saleId)}`;
  let referral: PartnerReferral;
  try {
    referral = await createPartnerReferral({ trackingId: organizerTrackingId(saleId), returnUrl });
  } catch (error) {
    const mapped = paypalErrorResponse(error, "organizer-referral");
    if (mapped) return mapped;
    throw error;
  }

  return Response.json({ actionUrl: referral.actionUrl });
}
