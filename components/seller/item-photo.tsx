import Image from "next/image";

import { cn } from "@/components/ui";

/**
 * A square item photo. Photos come straight from the public storage bucket (or a local
 * preview), so they are not run through the image optimizer.
 */
export function ItemPhoto({
  src,
  alt,
  sizes,
  className,
}: {
  src: string | null;
  alt: string;
  /** The rendered width, for the browser's choice of source. */
  sizes: string;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-square shrink-0 overflow-hidden rounded-field bg-paper-deep", className)}>
      {src ? (
        <Image src={src} alt={alt} fill unoptimized sizes={sizes} className="object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-xs text-ink-faint">No photo</span>
      )}
    </div>
  );
}
