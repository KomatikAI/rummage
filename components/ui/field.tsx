"use client";

import { useId, type ReactNode } from "react";

import { cn } from "./cn";
import { FieldContext } from "./field-context";
import { Label } from "./label";

export interface FieldProps {
  label: ReactNode;
  /** One Input or Textarea. It picks up the id, aria-describedby and aria-invalid. */
  children: ReactNode;
  /** A short plain sentence under the control. */
  hint?: ReactNode;
  /** Shown in red under the control and marks it invalid. */
  error?: ReactNode;
  optional?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
}

/** Label + control + hint + error, wired for screen readers. */
export function Field({ label, children, hint, error, optional = false, required, id, className }: FieldProps) {
  const generated = useId();
  const controlId = id ?? `field-${generated}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext value={{ id: controlId, describedBy, invalid: Boolean(error), required: required ?? false }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <Label htmlFor={controlId} optional={optional}>
          {label}
        </Label>
        {children}
        {hint ? (
          <p id={hintId} className="text-sm text-ink-soft">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext>
  );
}
