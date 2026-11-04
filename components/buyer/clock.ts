"use client";

import { useMemo, useSyncExternalStore } from "react";

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

/**
 * The browser clock shifted onto the server's: `serverNowMs` is Date.now() from the render
 * that sent the page and `firstClientNowMs` the browser's first reading after it. Page load
 * time sits inside the shift, so it is a few seconds behind at most.
 */
export function anchorToServer(clientNowMs: number, serverNowMs: number, firstClientNowMs: number): number {
  return clientNowMs + (serverNowMs - firstClientNowMs);
}

/**
 * A view of `base` on the server's clock. The first reading it sees from `base` is taken
 * as the moment the page arrived, and every later reading is shifted by the same amount.
 */
export function createAnchoredClock(base: ClockStore, serverNowMs: number): ClockStore {
  let firstClientNow: number | null = null;
  return {
    subscribe: base.subscribe,
    getSnapshot: () => {
      const now = base.getSnapshot();
      if (now === null) return null;
      if (firstClientNow === null) firstClientNow = now;
      return anchorToServer(now, serverNowMs, firstClientNow);
    },
  };
}

/**
 * useNow on the server's clock. Holds expire by the database's time, and a browser clock
 * minutes off would show a hold as live after it ended (checkout then fails) or as gone
 * while it still runs. Null until the browser has a reading, like useNow.
 */
export function useServerNow(serverNowMs: number): number | null {
  const anchored = useMemo(() => createAnchoredClock(clock, serverNowMs), [serverNowMs]);
  return useSyncExternalStore(anchored.subscribe, anchored.getSnapshot, serverSnapshot);
}
