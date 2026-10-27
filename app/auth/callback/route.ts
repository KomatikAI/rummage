import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { safeNext } from "../../(auth)/auth-helpers";

/**
 * Supabase email links land here with `?code=...&next=/path`. Exchanges the code for a
 * session cookie, then redirects to `next` (default "/"). A missing or bad code goes to
 * /sign-in with a plain message.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), "/");

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const signIn = new URL("/sign-in", origin);
  signIn.searchParams.set("error", "link");
  if (next !== "/") signIn.searchParams.set("next", next);
  return NextResponse.redirect(signIn);
}
