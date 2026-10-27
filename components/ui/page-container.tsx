import type { ComponentProps } from "react";

import { cn } from "./cn";

const widths = {
  content: "max-w-content",
  wide: "max-w-wide",
} as const;

export interface PageContainerProps extends ComponentProps<"main"> {
  /** content (40rem) for forms and lists, wide (64rem) for map + list layouts. */
  width?: keyof typeof widths;
}

/** Every page's <main>: centred, 16 px gutters, the skip-link target. */
export function PageContainer({ width = "content", className, ...rest }: PageContainerProps) {
  return <main id="main" className={cn("mx-auto w-full flex-1 px-gutter py-6", widths[width], className)} {...rest} />;
}
