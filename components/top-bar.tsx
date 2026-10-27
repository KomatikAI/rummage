import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { signOut } from "@/app/(auth)/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CurrentSaleName } from "./sale-name";
import { TopNav } from "./top-nav";
import { buttonClasses } from "./ui/button";
import { SubmitButton } from "./ui/submit-button";

/** Reads the session on the server. Streams in behind Suspense so the rest of the bar is static. */
async function AuthControl() {
  let email: string | null = null;
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
    email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  } catch (error) {
    // Let Next's own signals through; a missing env or an auth outage reads as signed out.
    unstable_rethrow(error);
    signedIn = false;
  }

  if (!signedIn) {
    return (
      <Link href="/sign-in" className={buttonClasses({ variant: "secondary", size: "sm" })}>
        Sign in
      </Link>
    );
  }

  return (
    <form action={signOut} className="flex items-center gap-2">
      {email ? <span className="hidden max-w-48 truncate text-sm text-ink-soft lg:inline">{email}</span> : null}
      <SubmitButton variant="ghost" size="sm" pendingLabel="Signing out">
        Sign out
      </SubmitButton>
    </form>
  );
}

function AuthControlFallback() {
  return <span aria-hidden="true" className="block h-tap w-20 rounded-pill bg-paper-deep" />;
}

export interface TopBarProps {
  /** Shown beside the wordmark. Sale pages can also set it with <SetSaleName />. */
  saleName?: string;
}

/** Sticky top bar: wordmark, current sale, laptop nav and the sign-in control. */
export function TopBar({ saleName }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-topbar w-full max-w-wide items-center gap-3 px-gutter">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 rounded-pill py-2 font-display text-2xl font-semibold tracking-tight">
          <span aria-hidden="true" className="size-2.5 rounded-pill bg-accent" />
          Rummage
        </Link>
        <div className="flex min-w-0 flex-1 items-center">
          {saleName ? (
            <span className="min-w-0 truncate border-l border-line pl-3 text-sm font-semibold text-ink-soft">{saleName}</span>
          ) : (
            <CurrentSaleName />
          )}
        </div>
        <TopNav />
        <Suspense fallback={<AuthControlFallback />}>
          <AuthControl />
        </Suspense>
      </div>
    </header>
  );
}
