import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { anchorToServer, createAnchoredClock, createClockStore } from "./clock";

describe("anchorToServer", () => {
  it("moves a fast browser clock back onto the server's", () => {
    // Browser is 5 minutes ahead; the server rendered at 1_000_000.
    expect(anchorToServer(1_300_000, 1_000_000, 1_300_000)).toBe(1_000_000);
    expect(anchorToServer(1_301_000, 1_000_000, 1_300_000)).toBe(1_001_000);
  });

  it("moves a slow browser clock forward", () => {
    expect(anchorToServer(700_000, 1_000_000, 700_000)).toBe(1_000_000);
  });

  it("is the identity when the clocks agree", () => {
    expect(anchorToServer(2_000, 1_000, 1_000)).toBe(2_000);
  });
});

describe("createAnchoredClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is null until the base clock reads, then follows it on the server's time", () => {
    let now = 1_300_000; // browser 5 minutes ahead of a server that rendered at 1_000_000
    const base = createClockStore(() => now, 1000);
    const anchored = createAnchoredClock(base, 1_000_000);
    expect(anchored.getSnapshot()).toBeNull();

    anchored.subscribe(() => {});
    expect(anchored.getSnapshot()).toBe(1_000_000);
    expect(anchored.getSnapshot()).toBe(anchored.getSnapshot());

    now = 1_301_000;
    vi.advanceTimersByTime(1000);
    expect(anchored.getSnapshot()).toBe(1_001_000);
  });
});

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
