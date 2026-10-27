"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";

import type { ReleaseHoldsState } from "./action-state";

type Action = (previous: ReleaseHoldsState, formData: FormData) => Promise<ReleaseHoldsState>;

function releasedLine(count: number): string {
  if (count === 0) return "No holds had run out. Nothing changed.";
  return count === 1 ? "Released 1 expired hold." : `Released ${count} expired holds.`;
}

/** "Release expired holds now": puts items whose hold ran out back on the shelf. */
export function ReleaseHolds({ saleId, action }: { saleId: string; action: Action }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="saleId" value={saleId} />
      <SubmitButton variant="secondary" pendingLabel="Releasing">
        Release expired holds now
      </SubmitButton>
      <p aria-live="polite" className="text-sm text-ink-soft">
        {state.error ? <span className="font-medium text-danger">{state.error}</span> : null}
        {state.released !== undefined ? releasedLine(state.released) : null}
      </p>
    </form>
  );
}
