"use client";

import { useActionState } from "react";

import { confirmPickup } from "@/app/seller/actions";
import { Label, SubmitButton } from "@/components/ui";

import type { PickupState } from "./action-state";
import { PICKUP_CODE_LENGTH } from "./forms";
import { Notice } from "./notice";

/** The handover: type the buyer's pickup code, and every paid item it covers is marked collected. */
export function PickupForm({ householdId }: { householdId: string }) {
  const [state, formAction] = useActionState<PickupState, FormData>(confirmPickup, {});
  const collected = state.collected ?? [];

  return (
    <div className="flex flex-col gap-4">
      {collected.length > 0 ? (
        <div
          key={state.attempt}
          role="status"
          className="flex w-full flex-col gap-2 rounded-sticker bg-ready px-5 py-6 text-on-ready shadow-sticker"
        >
          <p className="text-sm font-semibold">Code matches. Hand it over.</p>
          <ul className="flex flex-col gap-1">
            {collected.map((title, index) => (
              <li key={`${index}-${title}`} className="font-display text-2xl font-semibold leading-tight">
                {title}
              </li>
            ))}
          </ul>
          <p className="text-sm">{collected.length === 1 ? "Marked as picked up." : "All marked as picked up."}</p>
        </div>
      ) : null}

      <form action={formAction} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="householdId" value={householdId} />
        <Label htmlFor="pickup-code">Buyer&apos;s pickup code</Label>
        <input
          id="pickup-code"
          name="code"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={PICKUP_CODE_LENGTH + 2}
          placeholder="ABC234"
          aria-invalid={state.error ? true : undefined}
          aria-describedby="pickup-code-hint"
          className="block h-20 w-full rounded-field border-2 border-grey-300 bg-surface px-4 text-center font-display text-4xl font-semibold uppercase tracking-[0.3em] text-ink placeholder:text-grey-300 focus:border-accent aria-invalid:border-danger"
        />
        <p id="pickup-code-hint" className="text-sm text-ink-soft">
          {PICKUP_CODE_LENGTH} letters and numbers on the buyer&apos;s phone. Ask them to show it.
        </p>
        {state.error ? (
          <Notice key={state.attempt} tone="danger">
            {state.error}
          </Notice>
        ) : null}
        <SubmitButton variant="primary" size="lg" fullWidth pendingLabel="Checking the code">
          Check code
        </SubmitButton>
      </form>
    </div>
  );
}
