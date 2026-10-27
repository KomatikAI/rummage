import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

import type { Database } from "./types";

/**
 * Session refresh for the root `proxy.ts` (Next 16's replacement for middleware):
 *
 *   // proxy.ts (project root)
 *   import type { NextRequest } from "next/server";
 *   import { updateSession } from "@/lib/supabase/proxy";
 *   export async function proxy(request: NextRequest) {
 *     return updateSession(request);
 *   }
 *
 * Server Components cannot write cookies, so the refreshed auth cookies are written
 * here on every request. It only refreshes the session; it does not gate routes.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Validates the JWT and refreshes it when needed. Do not run code between creating
  // the client and this call.
  await supabase.auth.getClaims();

  return response;
}
