"use client";

import { useState } from "react";

import { cn } from "@/components/ui";

export interface ItemPhotoProps {
  src: string | null;
  alt: string;
  className?: string;
}

/** An item photo from the public bucket, with a quiet placeholder when it is missing or fails. */
export function ItemPhoto({ src, alt, className }: ItemPhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== null && failedSrc !== src;

  return (
    <div className={cn("relative overflow-hidden bg-paper-deep", className)}>
      {showImage ? (
        // Photos come from the storage bucket on another host; next/image would need remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          className="size-full object-cover"
        />
      ) : (
        <div role="img" aria-label={alt} className="flex size-full items-center justify-center text-ink-faint">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-8">
            <path
              d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Zm0 0 8 3.5m0 0 8-3.5M12 11v9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
