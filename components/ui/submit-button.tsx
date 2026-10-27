"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "./button";

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "loading"> {
  /** Label while the form's server action runs. Defaults to the normal label. */
  pendingLabel?: string;
}

/** A submit button that shows its loading state while the enclosing form is pending. */
export function SubmitButton({ pendingLabel, children, ...rest }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
