import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/ui";

import { AuthForm } from "../auth-form";
import { DEFAULT_AFTER_SIGN_IN, safeNext } from "../auth-helpers";

export const metadata: Metadata = { title: "Create an account · Rummage" };

async function SignUpWithParams({ searchParams }: { searchParams: PageProps<"/sign-up">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  return <AuthForm mode="sign-up" next={next} />;
}

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <PageContainer className="max-w-md">
      <PageHeader title="Create an account" description="One account to shop, sell from your driveway or run the whole sale." />
      <Suspense fallback={<AuthForm mode="sign-up" next={DEFAULT_AFTER_SIGN_IN} />}>
        <SignUpWithParams searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
