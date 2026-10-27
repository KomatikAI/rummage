import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/ui";

import { AuthForm } from "../auth-form";
import { DEFAULT_AFTER_SIGN_IN, safeNext } from "../auth-helpers";

export const metadata: Metadata = { title: "Sign in · Rummage" };

const LINK_ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Sign in below.",
};

async function SignInWithParams({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  return <AuthForm mode="sign-in" next={next} initialError={errorKey ? LINK_ERRORS[errorKey] : undefined} />;
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <PageContainer className="max-w-md">
      <PageHeader title="Sign in" description="Hold items, pay every household at once and keep your pickup codes." />
      <Suspense fallback={<AuthForm mode="sign-in" next={DEFAULT_AFTER_SIGN_IN} />}>
        <SignInWithParams searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
