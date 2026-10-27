"use client";

import { useEffect, useState } from "react";

import { Button, type ButtonProps } from "@/components/ui";

type CopyState = "idle" | "copied" | "failed";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  /** The text put on the clipboard. */
  value: string;
  label: string;
}

/** Copies `value` and says so in a live region; if the clipboard is blocked it says to copy by hand. */
export function CopyButton({ value, label, variant = "secondary", size = "sm", ...rest }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant={variant} size={size} onClick={copy} {...rest}>
        {state === "copied" ? "Copied" : label}
      </Button>
      <span aria-live="polite" className="text-sm text-ink-soft">
        {state === "failed" ? "Copying is blocked here. Select the text and copy it instead." : null}
        {state === "copied" ? <span className="sr-only">Copied</span> : null}
      </span>
    </span>
  );
}
