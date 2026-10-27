"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ReleaseHoldsState, StatusActionState } from "@/components/organizer/action-state";
import { currentUserId } from "@/lib/repos/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";

const SIGNED_OUT = "Your session ended. Sign in again and try once more.";
const NOT_YOURS = "Only this sale's organizer can do that.";

const statusSchema = z.object({ saleId: z.uuid(), status: z.enum(["open", "closed"]) });
const saleIdSchema = z.object({ saleId: z.uuid() });

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function organizerDb(): Promise<{ db: RummageClient; userId: string } | null> {
  const db = await createSupabaseServerClient();
  const userId = await currentUserId(db);
  return userId ? { db, userId } : null;
}

/** Opens or closes the sale. RLS and the organizer filter make a forged id update nothing. */
export async function setSaleStatus(_previous: StatusActionState, formData: FormData): Promise<StatusActionState> {
  const parsed = statusSchema.safeParse({ saleId: field(formData, "saleId"), status: field(formData, "status") });
  if (!parsed.success) return { error: "That change was not recognized. Reload the page and try again." };
  const session = await organizerDb();
  if (!session) return { error: SIGNED_OUT };

  const { saleId, status } = parsed.data;
  const { data, error } = await session.db
    .from("sales")
    .update({ status })
    .eq("id", saleId)
    .eq("organizer_user_id", session.userId)
    .select("id");
  if (error) {
    console.error("organizer: status update failed", error.code);
    return { error: "The sale could not be updated just now. Try again in a moment." };
  }
  if (!data || data.length === 0) return { error: NOT_YOURS };
  revalidatePath(`/organizer/${saleId}`, "layout");
  return {};
}

/**
 * Releases every hold whose time ran out. release_expired_holds() is granted to
 * service_role only and is global (not per sale), so the caller is first checked as
 * this sale's organizer through the cookie client, then the admin client runs it.
 */
export async function releaseExpiredHolds(_previous: ReleaseHoldsState, formData: FormData): Promise<ReleaseHoldsState> {
  const parsed = saleIdSchema.safeParse({ saleId: field(formData, "saleId") });
  if (!parsed.success) return { error: "That sale was not recognized. Reload the page and try again." };
  const session = await organizerDb();
  if (!session) return { error: SIGNED_OUT };

  const { saleId } = parsed.data;
  const owned = await session.db
    .from("sales")
    .select("id")
    .eq("id", saleId)
    .eq("organizer_user_id", session.userId)
    .maybeSingle();
  if (owned.error) return { error: "The sale could not be checked just now. Try again in a moment." };
  if (!owned.data) return { error: NOT_YOURS };

  const { data, error } = await createSupabaseAdminClient().rpc("release_expired_holds");
  if (error) {
    console.error("organizer: release_expired_holds failed", error.code);
    return { error: "Holds could not be released just now. Try again in a moment." };
  }
  revalidatePath(`/organizer/${saleId}`, "layout");
  return { released: typeof data === "number" ? data : 0 };
}
