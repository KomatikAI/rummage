"use client";

import type { ComponentProps } from "react";

import { cn } from "./cn";
import { controlClasses } from "./control-classes";
import { useFieldContext } from "./field-context";

export interface TextareaProps extends ComponentProps<"textarea"> {
  invalid?: boolean;
}

/** A multi-line text control. Use it inside a Field for a label and an error. */
export function Textarea({ id, invalid, required, rows = 4, className, ref, ...rest }: TextareaProps) {
  const field = useFieldContext();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <textarea
      ref={ref}
      id={id ?? field?.id}
      rows={rows}
      required={required ?? field?.required}
      aria-invalid={isInvalid || undefined}
      aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
      className={cn(controlClasses, "py-2.5 leading-relaxed", className)}
      {...rest}
    />
  );
}
