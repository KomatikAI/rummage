import type { RummageClient } from "@/lib/supabase/server";

/**
 * The signed-in user's id from the verified JWT (getClaims validates the token),
 * or null when signed out or the token is invalid.
 */
export async function getSignedInUserId(client: RummageClient): Promise<string | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) return null;
  const sub = data.claims.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}
