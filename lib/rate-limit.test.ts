import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit";

const options = { minIntervalMs: 1200, windowMs: 600_000, max: 3 };

describe("createRateLimiter", () => {
  it("enforces the minimum gap per user", () => {
    const limiter = createRateLimiter(options);
    expect(limiter.check("a", 0)).toEqual({ ok: true });
    expect(limiter.check("a", 1000)).toEqual({ ok: false, retryAfterMs: 200 });
    expect(limiter.check("b", 1000)).toEqual({ ok: true });
    expect(limiter.check("a", 1200)).toEqual({ ok: true });
  });

  it("caps calls per window and frees them as the window rolls", () => {
    const limiter = createRateLimiter(options);
    expect(limiter.check("a", 0).ok).toBe(true);
    expect(limiter.check("a", 2000).ok).toBe(true);
    expect(limiter.check("a", 4000).ok).toBe(true);
    expect(limiter.check("a", 6000)).toEqual({ ok: false, retryAfterMs: 594_000 });
    expect(limiter.check("a", 600_000).ok).toBe(true);
  });

  it("does not count refused calls", () => {
    const limiter = createRateLimiter(options);
    limiter.check("a", 0);
    limiter.check("a", 100);
    limiter.check("a", 200);
    expect(limiter.check("a", 1200).ok).toBe(true);
  });

  it("forgets everything on reset", () => {
    const limiter = createRateLimiter(options);
    limiter.check("a", 0);
    limiter.reset();
    expect(limiter.check("a", 1).ok).toBe(true);
  });
});
