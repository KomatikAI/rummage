import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { serverEnvSchema } from "@/lib/env";

import type { Database } from "./types";

const publicSupabaseEnv = serverEnvSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
});

/**
 * Browser Supabase client (anon key, RLS applies). `createBrowserClient` returns a
 * singleton in the browser, so calling this from several components is fine.
 *
 * The NEXT_PUBLIC_* values are read with literal `process.env.X` references so Next
 * inlines them at build time; they are validated with the same zod rules as lib/env.ts.
 * The full server env (getEnv) is not used here: its secrets do not exist in the browser.
 */
export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const values = publicSupabaseEnv.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return createBrowserClient<Database>(values.NEXT_PUBLIC_SUPABASE_URL, values.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
