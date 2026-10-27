import type { ComponentProps } from "react";

import { cn } from "./cn";

const paddings = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} as const;

const tones = {
  surface: "bg-surface border border-line shadow-sticker",
  sunken: "bg-paper-deep",
  accent: "bg-accent-soft",
} as const;

export interface CardProps extends ComponentProps<"div"> {
  padding?: keyof typeof paddings;
  tone?: keyof typeof tones;
}

/** A rounded, sticker-like container. Surface for content, sunken for quiet groups. */
export function Card({ padding = "md", tone = "surface", className, ref, ...rest }: CardProps) {
  return <div ref={ref} className={cn("rounded-sticker", tones[tone], paddings[padding], className)} {...rest} />;
}

export interface CardTitleProps extends ComponentProps<"h2"> {
  as?: "h2" | "h3";
}

export function CardTitle({ as: Tag = "h2", className, ...rest }: CardTitleProps) {
  return <Tag className={cn("font-display text-lg font-semibold leading-snug text-ink", className)} {...rest} />;
}
