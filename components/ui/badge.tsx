import type { ReactNode } from "react";

import { cn } from "./cn";
import { statusLabel, statusTone, type BadgeStatus, type BadgeTone } from "./status";

const tones: Record<BadgeTone, string> = {
  accent: "bg-accent-soft text-accent-strong",
  held: "bg-held-soft text-held",
  neutral: "bg-grey-200 text-ink-soft",
  "ready-soft": "bg-ready-soft text-ready-strong",
  ready: "bg-ready text-on-ready",
  outline: "border border-dashed border-grey-500 text-ink-soft",
};

export type BadgeProps = {
  className?: string;
  /** Overrides the label. The status still picks the colour. */
  children?: ReactNode;
} & ({ status: BadgeStatus; tone?: never } | { tone: BadgeTone; status?: never; children: ReactNode });

/** A small sticker-shaped status label. Pass a status, or a tone with your own label. */
export function Badge(props: BadgeProps) {
  const tone = props.status ? statusTone(props.status) : props.tone;
  const label = props.children ?? (props.status ? statusLabel(props.status) : null);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tones[tone],
        props.className,
      )}
    >
      {label}
    </span>
  );
}
