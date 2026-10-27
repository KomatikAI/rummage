import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "./cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors select-none " +
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent shadow-sticker hover:bg-accent-strong active:bg-accent-strong",
  secondary: "border border-grey-300 bg-surface text-ink hover:bg-paper-deep active:bg-grey-100",
  ghost: "bg-transparent text-ink hover:bg-paper-deep active:bg-grey-100",
  danger: "bg-danger text-on-danger hover:bg-danger-strong active:bg-danger-strong",
};

// Every size keeps a 44 px (min-h-tap) target; sm only tightens padding and type.
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-tap px-3.5 text-sm",
  md: "min-h-tap px-5 text-base",
  lg: "min-h-14 px-6 text-lg",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** The class string for a button look. Use it to style a link or a summary as a button. */
export function buttonClasses({ variant = "primary", size = "md", fullWidth = false, className }: ButtonStyleOptions = {}) {
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

export interface ButtonProps extends ComponentProps<"button">, Omit<ButtonStyleOptions, "className"> {
  /** Shows a spinner, disables the button and sets aria-busy. The label stays for width. */
  loading?: boolean;
}

/** A button. Defaults to type="button" so it never submits a form by accident. */
export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? "md" : "sm"} label={null} /> : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends ComponentProps<typeof Link>, Omit<ButtonStyleOptions, "className"> {}

/** A next/link that looks like a button. Use it for navigation, Button for actions. */
export function ButtonLink({ variant, size, fullWidth, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, fullWidth, className })} {...rest} />;
}
