"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the current page every few seconds, a limited number of times. */
export function AutoRefresh({ everyMs = 4000, times = 15 }: { everyMs?: number; times?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const id = window.setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= times) window.clearInterval(id);
    }, everyMs);
    return () => window.clearInterval(id);
  }, [router, everyMs, times]);
  return null;
}
