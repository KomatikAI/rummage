import type { ComponentProps } from "react";

import { cn } from "./cn";

export interface LabelProps extends ComponentProps<"label"> {
  /** Adds a quiet "(optional)" after the text. */
  optional?: boolean;
}

export function Label({ optional = false, className, children, ...rest }: LabelProps) {
  return (
    <label className={cn("block text-sm font-semibold text-ink", className)} {...rest}>
      {children}
      {optional ? <span className="ml-1 font-normal text-ink-faint">(optional)</span> : null}
    </label>
  );
}
