"use client";

import { useActionState } from "react";

import { joinSale } from "@/app/seller/actions";
import { Card, CardTitle, Field, Input, SubmitButton } from "@/components/ui";

import type { JoinSaleState } from "./action-state";
import { MAX_LABEL_LENGTH } from "./forms";
import { Notice } from "./notice";

/** Invite code + table name -> join_sale(). On success the action redirects to /seller. */
export function JoinSaleForm({ initialInviteCode = "" }: { initialInviteCode?: string }) {
  const [state, formAction] = useActionState<JoinSaleState, FormData>(joinSale, {
    values: { inviteCode: initialInviteCode, label: "" },
  });

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle>Join a sale</CardTitle>
        <p className="text-sm text-ink-soft">Your organizer has an invite code for your street. Paste it here and name your table.</p>
      </div>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        <Field label="Invite code" hint="A code or the whole invite link both work." error={state.fieldErrors?.inviteCode} required>
          <Input
            name="inviteCode"
            defaultValue={state.values?.inviteCode}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field label="Table name" hint="Buyers see this on the map." error={state.fieldErrors?.label} required>
          <Input
            name="label"
            defaultValue={state.values?.label}
            placeholder="The Alvarez table"
            maxLength={MAX_LABEL_LENGTH}
            autoComplete="off"
          />
        </Field>
        <SubmitButton fullWidth pendingLabel="Joining">
          Join sale
        </SubmitButton>
      </form>
    </Card>
  );
}
