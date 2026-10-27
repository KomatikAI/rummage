import type { RummageClient } from "@/lib/supabase/server";

/**
 * The signed-in user's id from the verified JWT (`getClaims`), or null when signed
 * out. Mirrors the private helper in lib/supabase/queries.ts.
 */
export async function currentUserId(db: RummageClient): Promise<string | null> {
  const { data, error } = await db.auth.getClaims();
  if (error || !data) return null;
  const sub = data.claims.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical uuid string. Ids from the model are checked before any query. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
