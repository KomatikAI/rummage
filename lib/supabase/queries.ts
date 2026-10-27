import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "./admin";
import { createSupabaseServerClient } from "./server";
import type {
  CartLineRow,
  CartRow,
  Database,
  HouseholdRow,
  Json,
  PickupRow,
  PublicListingRow,
} from "./types";

/**
 * Typed data helpers. Each takes an optional client so tests (and callers that already
 * hold one) can pass it in; by default the user-scoped cookie client is used, and
 * recordPayPalEvent uses the service-role client.
 */

type Client = SupabaseClient<Database>;

export type CartWithLines = CartRow & { cart_lines: CartLineRow[] };

/** The PayPal webhook event fields recordPayPalEvent stores (the whole event goes in payload). */
export type PayPalEventInput = {
  id: string;
  event_type: string;
  resource_type?: string | null;
  resource?: { id?: string; [key: string]: Json | undefined } | null;
  [key: string]: Json | undefined;
};

export class SupabaseQueryError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`${operation}: ${message}`);
    this.name = "SupabaseQueryError";
  }
}

function fail(operation: string, error: { code?: string; message: string }): never {
  throw new SupabaseQueryError(operation, error.code, error.message);
}

/** The signed-in user's id from the verified JWT, or null when signed out. */
async function currentUserId(db: Client): Promise<string | null> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data) return null;
  const sub = data.claims.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/** Every public listing in a sale (listed, held and sold items; jittered pins only). */
export async function getPublicListings(saleSlug: string, client?: Client): Promise<PublicListingRow[]> {
  const db = client ?? (await createSupabaseServerClient());
  const { data, error } = await db
    .from("public_listings")
    .select("*")
    .eq("sale_slug", saleSlug)
    .order("household_label", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) fail("getPublicListings", error);
  return data ?? [];
}

/** The signed-in seller's household in a sale, or null (signed out or not joined). */
export async function getMyHousehold(saleId: string, client?: Client): Promise<HouseholdRow | null> {
  const db = client ?? (await createSupabaseServerClient());
  const userId = await currentUserId(db);
  if (!userId) return null;
  // Filter on owner explicitly: RLS also lets an organizer read every household of
  // their sale, so RLS alone does not mean "mine".
  const { data, error } = await db
    .from("households")
    .select("*")
    .eq("sale_id", saleId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) fail("getMyHousehold", error);
  return data;
}

/** The signed-in buyer's live (open or checkout) cart in a sale with its lines, or null. */
export async function getMyCart(saleId: string, client?: Client): Promise<CartWithLines | null> {
  const db = client ?? (await createSupabaseServerClient());
  const userId = await currentUserId(db);
  if (!userId) return null;
  const { data, error } = await db
    .from("carts")
    .select("*, cart_lines(*)")
    .eq("sale_id", saleId)
    .eq("buyer_user_id", userId)
    .in("status", ["open", "checkout"])
    .maybeSingle();
  if (error) fail("getMyCart", error);
  return data;
}

/** Exact pickup locations and codes for the signed-in buyer's completed captures. */
export async function getMyPickups(client?: Client): Promise<PickupRow[]> {
  const db = client ?? (await createSupabaseServerClient());
  const { data, error } = await db.rpc("get_my_pickups");
  if (error) fail("getMyPickups", error);
  return data ?? [];
}

/**
 * Stores a PayPal webhook event once. Returns true when it was new, false when the
 * event_id was already recorded (PayPal retries deliveries), so callers can skip
 * duplicate processing. Uses the service-role client: paypal_events has no client access.
 */
export async function recordPayPalEvent(event: PayPalEventInput, client?: Client): Promise<boolean> {
  if (!event.id || !event.event_type) {
    throw new SupabaseQueryError("recordPayPalEvent", undefined, "event id and event_type are required");
  }
  const db = client ?? createSupabaseAdminClient();
  const resourceId = typeof event.resource?.id === "string" ? event.resource.id : null;
  const { data, error } = await db
    .from("paypal_events")
    .upsert(
      {
        event_id: event.id,
        event_type: event.event_type,
        resource_type: event.resource_type ?? null,
        resource_id: resourceId,
        payload: event,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (error) fail("recordPayPalEvent", error);
  return (data ?? []).length > 0;
}
