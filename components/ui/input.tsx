"use client";

import type { ComponentProps } from "react";

import { cn } from "./cn";
import { controlClasses } from "./control-classes";
import { useFieldContext } from "./field-context";

export interface InputProps extends ComponentProps<"input"> {
  /** Marks the control invalid. Inside a Field this follows the Field's error. */
  invalid?: boolean;
}

/** A text input, 44 px tall. Use it inside a Field for a label and an error. */
export function Input({ id, invalid, required, className, ref, ...rest }: InputProps) {
  const field = useFieldContext();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <input
      ref={ref}
      id={id ?? field?.id}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
      className={cn(controlClasses, "min-h-tap", className)}
      {...rest}
    />
  );
}
