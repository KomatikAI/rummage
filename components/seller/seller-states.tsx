import { ButtonLink, EmptyState, PageHeader, Spinner } from "@/components/ui";

/** Shared whole-page states for the seller pages. */

export function SignedOut({ next, description }: { next: string; description: string }) {
  return (
    <>
      <PageHeader title="Sell at a sale" />
      <EmptyState
        title="Sign in to sell"
        description={description}
        action={
          <ButtonLink href={`/sign-in?next=${encodeURIComponent(next)}`} variant="primary">
            Sign in
          </ButtonLink>
        }
      />
    </>
  );
}

export function NoTable({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        title="Join a sale first"
        description="Your items belong to a table at a sale. Join one with the invite code from your organizer."
        action={
          <ButtonLink href="/seller" variant="primary">
            Join a sale
          </ButtonLink>
        }
      />
    </>
  );
}

export function SellerLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center text-ink-soft">
      <Spinner size="lg" label="Loading your table" />
    </div>
  );
}
