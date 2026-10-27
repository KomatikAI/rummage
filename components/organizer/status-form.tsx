"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";

import type { StatusActionState } from "./action-state";
import type { StatusAction } from "./dashboard";

type Action = (previous: StatusActionState, formData: FormData) => Promise<StatusActionState>;

/** Open sale / Close sale, each a small form posting to the setSaleStatus server action. */
export function StatusForm({ saleId, actions, action }: { saleId: string; actions: StatusAction[]; action: Action }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="saleId" value={saleId} />
        {actions.map((entry) => (
          <SubmitButton key={entry.to} name="status" value={entry.to} variant={entry.variant} pendingLabel="Saving">
            {entry.label}
          </SubmitButton>
        ))}
      </form>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
