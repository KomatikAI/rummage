import { createSupabaseServerClient, type RummageClient } from "@/lib/supabase/server";

import { SupabaseItemsRepo } from "./items-repo";
import { SupabaseSaleReadRepo } from "./sale-read-repo";

/**
 * Supabase-backed repos for lib/ai. Both run as the signed-in user (cookie client, anon
 * key, RLS), never as the service role.
 */

export { currentUserId, isUuid } from "./auth";
export { ensureLiveCart, type LiveCart } from "./carts";
export { RepoError, type RepoErrorCode } from "./errors";
export {
  distanceMetres,
  searchTokens,
  SupabaseItemsRepo,
  toShopStatus,
  type SupabaseItemsRepoOptions,
} from "./items-repo";
export {
  organizerSummarySchema,
  saleDateTime,
  SupabaseSaleReadRepo,
  toSummaryStatus,
} from "./sale-read-repo";

export interface Repos {
  /** The client the repos use; reuse it for auth checks in the same request. */
  client: RummageClient;
  items: SupabaseItemsRepo;
  sale: SupabaseSaleReadRepo;
}

/**
 * Builds both repos for one request and one sale. Pass `client` when the route already
 * holds one (it must be the same request's cookie client).
 */
export async function createRepos(saleId: string, client?: RummageClient): Promise<Repos> {
  const db = client ?? (await createSupabaseServerClient());
  return {
    client: db,
    items: new SupabaseItemsRepo(db, { saleId }),
    sale: new SupabaseSaleReadRepo(db),
  };
}
