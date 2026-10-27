"use client";

import { useActionState } from "react";

import { Card, CardTitle, Field, Input, SubmitButton, Textarea } from "@/components/ui";

import { Notice } from "./notice";
import { DESCRIPTION_MAX_LENGTH, EMPTY_SALE_FORM, type SaleFormState } from "./sale-form";

type Action = (previous: SaleFormState, formData: FormData) => Promise<SaleFormState>;

/** The "Start a sale" form. Validation runs in the createSale server action. */
export function NewSaleForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, { values: EMPTY_SALE_FORM });
  const values = state.values;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {state.formError ? <Notice tone="danger">{state.formError}</Notice> : null}

      <Card className="flex flex-col gap-4">
        <CardTitle>The sale</CardTitle>
        <Field label="Sale name" hint="For example, Forest Park Fall Rummage." error={errors.name} required>
          <Input name="name" defaultValue={values.name} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" error={errors.saleDate} required>
            <Input type="date" name="saleDate" defaultValue={values.saleDate} />
          </Field>
          <Field label="Starts" error={errors.startsAt} required>
            <Input type="time" name="startsAt" defaultValue={values.startsAt} />
          </Field>
          <Field label="Ends" error={errors.endsAt} required>
            <Input type="time" name="endsAt" defaultValue={values.endsAt} />
          </Field>
        </div>
        <Field
          label="Short description"
          hint="What kinds of things, and anything buyers should know."
          error={errors.description}
          optional
        >
          <Textarea name="description" rows={3} maxLength={DESCRIPTION_MAX_LENGTH} defaultValue={values.description} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Meeting area</CardTitle>
          <p className="text-sm text-ink-soft">
            A point and a radius, never a street address. Each household&apos;s pin is moved a little before buyers see it,
            so nobody&apos;s exact home shows on the map. The example is Forest Park in St. Louis.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Latitude" error={errors.areaLat} required>
            <Input name="areaLat" inputMode="decimal" defaultValue={values.areaLat} />
          </Field>
          <Field label="Longitude" error={errors.areaLng} required>
            <Input name="areaLng" inputMode="decimal" defaultValue={values.areaLng} />
          </Field>
          <Field label="Radius in meters" error={errors.areaRadiusM} required>
            <Input name="areaRadiusM" inputMode="numeric" defaultValue={values.areaRadiusM} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Fundraiser</CardTitle>
          <p className="text-sm text-ink-soft">
            If the sale raises money for a school or club, buyers can add a donation at checkout once you link its
            PayPal.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who it supports" hint="For example, Maple Street Elementary PTA." error={errors.fundraiserName} optional>
            <Input name="fundraiserName" defaultValue={values.fundraiserName} autoComplete="organization" />
          </Field>
          <Field label="Goal in dollars" error={errors.fundraiserGoal} optional>
            <Input name="fundraiserGoal" inputMode="decimal" defaultValue={values.fundraiserGoal} />
          </Field>
        </div>
      </Card>

      <div className="flex flex-col gap-2">
        <SubmitButton size="lg" fullWidth pendingLabel="Creating the sale">
          Create the sale
        </SubmitButton>
        <p className="text-center text-sm text-ink-soft">It starts as a draft. Buyers see it once you open it.</p>
      </div>
    </form>
  );
}
