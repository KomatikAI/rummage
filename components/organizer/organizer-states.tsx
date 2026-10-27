import { ButtonLink, Card, EmptyState, Spinner } from "@/components/ui";

/** Shown to a signed-out visitor on any organizer page. */
export function OrganizerSignedOut({ next }: { next: string }) {
  return (
    <EmptyState
      title="Sign in to run your sale"
      description="Organizers sign in to start a sale, invite households and see how it is going."
      action={<ButtonLink href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</ButtonLink>}
    />
  );
}

/** The Suspense fallback for organizer pages. */
export function OrganizerLoading() {
  return (
    <Card tone="sunken" className="flex items-center gap-3 text-ink-soft">
      <Spinner size="sm" label={null} />
      <span>Loading your sale</span>
    </Card>
  );
}
