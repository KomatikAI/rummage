"use client";

import { useId } from "react";

import { Label } from "@/components/ui";
import { controlClasses } from "@/components/ui/control-classes";
import { cn } from "@/components/ui";

/** A labelled native select with the same look as Input. */
export function SelectField<T extends string>({
  label,
  name,
  value,
  options,
  labels,
  onChange,
  error,
  disabled,
}: {
  label: string;
  name: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          const next = options.find((option) => option === event.target.value);
          if (next !== undefined) onChange(next);
        }}
        className={cn(controlClasses, "min-h-tap")}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
