import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { Database } from "./types";

/*
 * Service-role client: bypasses RLS. Server only.
 *
 * `import "server-only"` is not used: the `server-only` package is not installed (Next
 * aliases it inside its own bundler, but vitest and other tools cannot resolve it), so
 * this module guards at runtime instead. The service role key is not a NEXT_PUBLIC_
 * variable, so it is never inlined into a client bundle either way.
 */
if (typeof window !== "undefined") {
  throw new Error("lib/supabase/admin.ts is server-only and must never be imported in the browser.");
}

let adminClient: SupabaseClient<Database> | undefined;

/** Returns the cached service-role client. */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase service-role client cannot be used in the browser.");
  }
  if (!adminClient) {
    adminClient = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return adminClient;
}
