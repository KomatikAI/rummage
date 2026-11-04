/**
 * Date.now() when a server page is built. Passed to the client clocks in
 * components/buyer/clock.ts as their anchor, so hold countdowns run on the
 * server's time rather than the browser's.
 */
export function pageRenderedAt(): number {
  return Date.now();
}
