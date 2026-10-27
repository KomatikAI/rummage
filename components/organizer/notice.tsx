import type { ReactNode } from "react";

import { cn } from "@/components/ui";

const tones = {
  ready: "bg-ready-soft text-ready-strong",
  pending: "border border-dashed border-grey-500 bg-surface text-ink",
  danger: "bg-danger-soft text-danger-strong",
  quiet: "bg-paper-deep text-ink-soft",
} as const;

export type NoticeTone = keyof typeof tones;

/** A short message in a rounded box. Errors use role="alert", everything else role="status". */
export function Notice({ tone, children, className }: { tone: NoticeTone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-field px-4 py-3 text-sm font-medium", tones[tone], className)}
    >
      {children}
    </div>
  );
}
