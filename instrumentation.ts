// Runs once when a Next.js server instance starts. Validating the env here
// makes the server refuse to start unless PAYPAL_ENV=sandbox and every
// required variable is set. Skipped during `next build`, which needs no secrets.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { getEnv } = await import("./lib/env");
  getEnv();
}
