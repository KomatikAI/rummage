import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { env } from "@/lib/env";

import type { Database } from "./types";

export type RummageClient = SupabaseClient<Database>;

/**
 * Cookie-based Supabase client for Server Components, Server Functions and Route
 * Handlers. Uses the anon key, so every query runs as the signed-in user under RLS.
 *
 * Create one per request: `cookies()` is request-scoped (and async in Next 16).
 */
export async function createSupabaseServerClient(): Promise<RummageClient> {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore
          // when the proxy (lib/supabase/proxy.ts) refreshes the session on each request.
        }
      },
    },
  });
}
