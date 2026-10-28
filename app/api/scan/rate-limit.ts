/**
 * Best-effort, in-memory rate limit for /api/scan: per user, a minimum gap between calls
 * plus a cap per rolling window. State lives in this module, so it is per server instance
 * only: a cold start forgets it and two instances do not share it. It stops a phone left
 * on auto-scan (or a stuck loop) from hammering the API; it is not abuse protection.
 */

export interface RateLimitOptions {
  /** Least time between two accepted calls from one user. */
  minIntervalMs: number;
  /** Length of the rolling window. */
  windowMs: number;
  /** Most accepted calls per user per window. */
  max: number;
}

export type RateLimitVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  /** Records the call when it is allowed. */
  check(userId: string, now?: number): RateLimitVerdict;
  reset(): void;
}

/** Users tracked before old entries are swept, so the map cannot grow without bound. */
const SWEEP_AT = 5000;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const calls = new Map<string, number[]>();

  function sweep(now: number) {
    for (const [userId, times] of calls) {
      const last = times[times.length - 1];
      if (last === undefined || now - last >= options.windowMs) calls.delete(userId);
    }
  }

  return {
    check(userId, now = Date.now()) {
      if (calls.size >= SWEEP_AT) sweep(now);
      const recent = (calls.get(userId) ?? []).filter((time) => now - time < options.windowMs);
      const last = recent[recent.length - 1];
      if (last !== undefined && now - last < options.minIntervalMs) {
        calls.set(userId, recent);
        return { ok: false, retryAfterMs: options.minIntervalMs - (now - last) };
      }
      const oldest = recent[0];
      if (recent.length >= options.max && oldest !== undefined) {
        calls.set(userId, recent);
        return { ok: false, retryAfterMs: options.windowMs - (now - oldest) };
      }
      recent.push(now);
      calls.set(userId, recent);
      return { ok: true };
    },
    reset() {
      calls.clear();
    },
  };
}

/** The limiter /api/scan uses: 1.2 s between scans, 60 scans per 10 minutes. */
export const scanRateLimiter = createRateLimiter({
  minIntervalMs: 1200,
  windowMs: 10 * 60 * 1000,
  max: 60,
});
