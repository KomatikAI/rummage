import type { ReactNode } from "react";

import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** A decorative icon, 24 to 32 px. Hidden from screen readers. */
  icon?: ReactNode;
  /** Usually one ButtonLink or Button. */
  action?: ReactNode;
  className?: string;
}

/** What a list shows when it has nothing yet: what is missing, and the one thing to do next. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-sticker border border-dashed border-grey-300 px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? (
        <div aria-hidden="true" className="flex size-12 items-center justify-center rounded-pill bg-paper-deep text-ink-soft">
          {icon}
        </div>
      ) : null}
      <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="max-w-xs text-sm text-ink-soft">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
