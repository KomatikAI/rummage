import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "./cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** A small line above the title, such as the sale date. */
  eyebrow?: ReactNode;
  /** A back link shown above everything else. */
  back?: { href: string; label: string };
  /** Buttons on the right on laptops, under the text on phones. */
  actions?: ReactNode;
  className?: string;
}

/** The one h1 on a page, in the display face. */
export function PageHeader({ title, description, eyebrow, back, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {back ? (
          <Link
            href={back.href}
            className="-ml-1 mb-1 inline-flex min-h-tap w-fit items-center gap-1 rounded-pill px-1 text-sm font-semibold text-ink-soft hover:text-ink"
          >
            <span aria-hidden="true">←</span>
            {back.label}
          </Link>
        ) : null}
        {eyebrow ? <p className="text-sm font-semibold text-accent-strong">{eyebrow}</p> : null}
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description ? <p className="text-base text-ink-soft">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
