import type { Metadata } from "next";

import { ButtonLink, Card, PageContainer, PageHeader, SubmitButton } from "@/components/ui";

import { signOut } from "../actions";

export const metadata: Metadata = { title: "Sign out · Rummage" };

/** A plain page for the sign-out action, for links and for anyone without the top bar. */
export default function SignOutPage() {
  return (
    <PageContainer className="max-w-md">
      <PageHeader title="Sign out" description="Your holds and pickup codes stay with your account." />
      <Card padding="lg">
        <form action={signOut} className="flex flex-col gap-3">
          <SubmitButton fullWidth size="lg" pendingLabel="Signing out">
            Sign out
          </SubmitButton>
          <ButtonLink href="/sale/demo" variant="ghost" fullWidth>
            Keep browsing
          </ButtonLink>
        </form>
      </Card>
    </PageContainer>
  );
}
