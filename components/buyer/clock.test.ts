import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClockStore } from "./clock";

describe("createClockStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("has no reading until someone subscribes", () => {
    const store = createClockStore(() => 1000);
    expect(store.getSnapshot()).toBeNull();
  });

  it("ticks every interval and stops when the last listener leaves", async () => {
    let now = 1000;
    const store = createClockStore(() => now, 1000);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.getSnapshot()).toBe(1000);

    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);

    now = 2000;
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot()).toBe(2000);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    now = 3000;
    vi.advanceTimersByTime(5000);
    expect(store.getSnapshot()).toBe(2000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the same snapshot between ticks", () => {
    const store = createClockStore(() => 5, 1000);
    store.subscribe(() => {});
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});
