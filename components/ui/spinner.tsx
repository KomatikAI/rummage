import { cn } from "./cn";

const sizes = {
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
} as const;

export interface SpinnerProps {
  size?: keyof typeof sizes;
  /** Read by screen readers. Pass null when a parent already announces the busy state. */
  label?: string | null;
  className?: string;
}

/** A small spinning ring in the current text colour. */
export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} className={cn("inline-flex shrink-0", className)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={cn(sizes[size], "animate-spin motion-reduce:animate-none")}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
