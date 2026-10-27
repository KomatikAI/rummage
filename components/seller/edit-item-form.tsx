"use client";

import { useActionState } from "react";

import { updateItem } from "@/app/seller/actions";
import { Card, CardTitle, Field, Input, SubmitButton, Textarea } from "@/components/ui";

import type { EditItemState } from "./action-state";
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from "./forms";
import { Notice } from "./notice";

/** Title, price and description of an item the seller still controls. */
export function EditItemForm({
  itemId,
  initial,
}: {
  itemId: string;
  initial: { title: string; description: string; price: string };
}) {
  const [state, formAction] = useActionState<EditItemState, FormData>(updateItem, { values: initial });
  const values = state.values ?? initial;

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <CardTitle as="h2">Edit details</CardTitle>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="itemId" value={itemId} />
        {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
        {state.saved ? <Notice tone="ready">Saved. Buyers see the new details now.</Notice> : null}
        <Field label="Name" error={state.fieldErrors?.title} required>
          <Input name="title" defaultValue={values.title} maxLength={MAX_TITLE_LENGTH} />
        </Field>
        <Field label="Price" hint="In dollars, like 5 or 12.50." error={state.fieldErrors?.price} required>
          <Input name="price" defaultValue={values.price} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Description" error={state.fieldErrors?.description} optional>
          <Textarea name="description" defaultValue={values.description} rows={3} maxLength={MAX_DESCRIPTION_LENGTH} />
        </Field>
        <SubmitButton variant="primary" fullWidth pendingLabel="Saving">
          Save changes
        </SubmitButton>
      </form>
    </Card>
  );
}
