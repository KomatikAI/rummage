"use client";

import { Button, EmptyState, PageContainer, PageHeader } from "@/components/ui";

/** Shown when a seller page could not load its data. */
export default function SellerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageContainer>
      <PageHeader title="Your table" />
      <EmptyState
        title="We could not load your table"
        description="Something went wrong on our side. Your items are safe. Try again in a moment."
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </PageContainer>
  );
}
