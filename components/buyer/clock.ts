"use client";

import { useSyncExternalStore } from "react";

/**
 * A one-second clock shared by every countdown on the page. The server snapshot is null,
 * so nothing time-based renders until the browser has a clock (no hydration mismatch and
 * no `Date.now()` during prerender).
 */

export type ClockStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number | null;
};

export function createClockStore(now: () => number = Date.now, intervalMs = 1000): ClockStore {
  let current: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  const tick = () => {
    current = now();
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (timer === null) {
        current = now();
        timer = setInterval(tick, intervalMs);
        // Tell the new subscriber about the first reading without waiting a full second.
        queueMicrotask(() => {
          if (listeners.has(listener)) listener();
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    getSnapshot: () => current,
  };
}

const clock = createClockStore();
const serverSnapshot = () => null;

/** Milliseconds since the epoch, updated every second; null on the server and first paint. */
export function useNow(): number | null {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, serverSnapshot);
}
