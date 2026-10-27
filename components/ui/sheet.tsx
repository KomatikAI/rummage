"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { cn } from "./cn";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  open: boolean;
  /** Called on Escape, a tap on the backdrop, or the close button. Set open to false here. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Pinned under the content, usually the primary action. */
  footer?: ReactNode;
  /** Label of the close button, read by screen readers. */
  closeLabel?: string;
  className?: string;
}

/**
 * A bottom sheet on phones and a centred dialog on laptops, built on the native modal
 * <dialog>: the page behind is inert, focus stays inside, Escape closes it, and focus
 * returns to whatever opened it.
 */
export function Sheet({ open, onClose, title, description, children, footer, closeLabel = "Close", className }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  // Close the native dialog if the component unmounts while open.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Escape: keep the dialog under React's control instead of closing it natively.
    event.preventDefault();
    onClose();
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    // A click on the dialog element itself (not its panel) is a click on the backdrop.
    if (event.target === event.currentTarget) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "mx-0 mt-auto mb-0 w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-ink/40",
        "open:animate-sheet-up motion-reduce:open:animate-none",
        "md:m-auto md:max-w-md",
      )}
    >
      <div
        className={cn(
          "relative flex max-h-[85dvh] flex-col rounded-t-sticker bg-surface pb-safe shadow-sticker md:rounded-sticker md:pb-0",
          className,
        )}
      >
        <div className="flex items-start gap-3 px-gutter pt-3 pb-2">
          <div aria-hidden="true" className="absolute inset-x-0 top-1.5 mx-auto h-1 w-10 rounded-pill bg-grey-300 md:hidden" />
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-3">
            <h2 id={titleId} className="font-display text-xl font-semibold leading-snug">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-ink-soft">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 mt-1 inline-flex size-tap shrink-0 items-center justify-center rounded-pill text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="sr-only">{closeLabel}</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-gutter pb-4">{children}</div>
        {footer ? <div className="border-t border-line px-gutter py-3">{footer}</div> : null}
      </div>
    </dialog>
  );
}
