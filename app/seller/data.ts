import { pickHousehold } from "@/components/seller/seller-copy";
import { currentUserId } from "@/lib/repos/auth";
import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";
import type { HouseholdRow, ItemRow } from "@/lib/supabase/types";

/** Server-only reads shared by the seller pages. Every query runs as the seller under RLS. */

export const ITEM_PHOTO_BUCKET = "item-photos";

export type SellerContext =
  | { kind: "signed-out" }
  | { kind: "no-household"; db: RummageClient; userId: string }
  | {
      kind: "ready";
      db: RummageClient;
      userId: string;
      households: HouseholdRow[];
      household: HouseholdRow;
      saleName: string | null;
    };

/** The signed-in seller and the household a page shows (`?household=` when theirs, else the newest). */
export async function loadSellerContext(requestedHouseholdId?: string): Promise<SellerContext> {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  if (!userId) return { kind: "signed-out" };

  // Filter on owner: RLS also lets an organizer read every household in their sale.
  const { data, error } = await db
    .from("households")
    .select("*")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load households: ${error.message}`);

  const households = data ?? [];
  const household = pickHousehold(households, requestedHouseholdId);
  if (!household) return { kind: "no-household", db, userId };

  const sale = await db.from("sales").select("name").eq("id", household.sale_id).maybeSingle();
  return { kind: "ready", db, userId, households, household, saleName: sale.data?.name ?? null };
}

/** Every item of one household, newest first. */
export async function loadHouseholdItems(db: RummageClient, householdId: string): Promise<ItemRow[]> {
  const { data, error } = await db
    .from("items")
    .select("*")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load items: ${error.message}`);
  return data ?? [];
}

/** Public URL of an item photo (the bucket is public-read), or null without a photo. */
export function photoUrl(db: RummageClient, path: string | null): string | null {
  if (!path) return null;
  return db.storage.from(ITEM_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
