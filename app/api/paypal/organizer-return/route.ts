import { z } from "zod";

import {
  organizerTrackingId,
  refreshOrganizerOnboarding,
  type OrganizerRefreshResult,
} from "@/components/organizer/onboarding";
import { appBaseUrl, databaseError, jsonError, paypalErrorResponse, unauthorized } from "@/lib/checkout/http";
import { getSignedInUserId } from "@/lib/checkout/session";
import { env } from "@/lib/env";
import { parsePartnerReturn } from "@/lib/paypal";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const saleIdSchema = z.uuid();
const merchantIdSchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/, "must be a PayPal merchant id");

/**
 * GET /api/paypal/organizer-return?saleId=...&merchantIdInPayPal=...
 * PayPal sends the organizer here after sign-up. The query comes through the browser,
 * so readiness is re-read from PayPal before anything is stored. The merchant id is
 * written to sales.organizer_merchant_id only when the account is ready (see
 * components/organizer/onboarding.ts). Redirects (303) to
 * /organizer/<saleId>?onboarding=<ready|pending>.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const saleId = saleIdSchema.safeParse(params.get("saleId"));
  if (!saleId.success) return jsonError(400, "invalid_sale", "saleId must be a uuid.");

  const returned = parsePartnerReturn(params);
  const merchantId = merchantIdSchema.safeParse(returned.merchantIdInPayPal);
  if (!merchantId.success) {
    return jsonError(400, "missing_merchant_id", "PayPal did not return a merchant id. Try linking again.");
  }

  const userId = await getSignedInUserId(await createSupabaseServerClient());
  if (!userId) return unauthorized();

  const admin = createSupabaseAdminClient();
  const sale = await admin.from("sales").select("id, organizer_user_id").eq("id", saleId.data).maybeSingle();
  if (sale.error) return databaseError("load sale", sale.error);
  if (!sale.data) return jsonError(404, "sale_not_found", "No such sale.");
  if (sale.data.organizer_user_id === null || sale.data.organizer_user_id !== userId) {
    return jsonError(403, "forbidden", "This sale belongs to someone else.");
  }
  // PayPal echoes our tracking id as `merchantId`; when present it must be this sale's.
  if (returned.trackingId !== undefined && returned.trackingId !== organizerTrackingId(sale.data.id)) {
    return jsonError(400, "tracking_mismatch", "This PayPal return is for a different sale.");
  }

  let refreshed: OrganizerRefreshResult;
  try {
    refreshed = await refreshOrganizerOnboarding(admin, sale.data, merchantId.data);
  } catch (error) {
    const mapped = paypalErrorResponse(error, "organizer-return");
    if (mapped) return mapped;
    throw error;
  }
  if (refreshed.kind === "tracking_mismatch") {
    return jsonError(403, "tracking_mismatch", "That PayPal account was linked for something else.");
  }
  if (refreshed.kind === "db_error") return databaseError("store organizer onboarding", { code: refreshed.code });

  const target = new URL(`${appBaseUrl(env.APP_URL)}/organizer/${encodeURIComponent(sale.data.id)}`);
  target.searchParams.set("onboarding", refreshed.status);
  return Response.redirect(target.toString(), 303);
}
