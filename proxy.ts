import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/** Next 16 Proxy (formerly middleware): refreshes the Supabase session cookies. It gates nothing. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation, and the PayPal webhook
    // (server-to-server, no session cookies).
    "/((?!_next/static|_next/image|favicon.ico|api/paypal/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
