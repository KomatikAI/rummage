/**
 * The "Auto" toggle as a pure state machine: while on, it asks for a scan every
 * AUTO_INTERVAL_MS once the last one has finished, but only while the camera is live,
 * the page is visible and nothing is in flight. It switches itself off after
 * AUTO_MAX_SCANS scans or AUTO_IDLE_MS without a tap, so a phone left on a table does not
 * keep scanning.
 */

export const AUTO_INTERVAL_MS = 3000;
export const AUTO_MAX_SCANS = 20;
export const AUTO_IDLE_MS = 2 * 60 * 1000;

export type AutoStopReason = "limit" | "idle";

export type AutoScanState = {
  on: boolean;
  live: boolean;
  visible: boolean;
  inFlight: boolean;
  /** When the last scan finished (or started, while one is in flight). */
  lastScanAt: number | null;
  /** Auto scans since the last tap. */
  scansSinceTap: number;
  lastTapAt: number;
  /** Why auto switched itself off, until it is switched on again. */
  stopped: AutoStopReason | null;
};

export type AutoScanEvent =
  | { type: "toggle"; now: number }
  /** Any tap on the screen, including a manual scan. */
  | { type: "tap"; now: number }
  | { type: "start"; now: number }
  | { type: "finish"; now: number }
  | { type: "visibility"; visible: boolean }
  | { type: "live"; live: boolean };

export function initialAutoScan(now: number): AutoScanState {
  return {
    on: false,
    live: false,
    visible: true,
    inFlight: false,
    lastScanAt: null,
    scansSinceTap: 0,
    lastTapAt: now,
    stopped: null,
  };
}

export function autoScanReducer(state: AutoScanState, event: AutoScanEvent): AutoScanState {
  switch (event.type) {
    case "toggle":
      return state.on
        ? { ...state, on: false, stopped: null }
        : { ...state, on: true, stopped: null, scansSinceTap: 0, lastTapAt: event.now, lastScanAt: null };
    case "tap":
      return { ...state, lastTapAt: event.now, scansSinceTap: 0 };
    case "start":
      return { ...state, inFlight: true, lastScanAt: event.now };
    case "finish":
      return { ...state, inFlight: false, lastScanAt: event.now };
    case "visibility":
      return { ...state, visible: event.visible };
    case "live":
      return event.live ? { ...state, live: true } : { ...state, live: false, on: false };
  }
}

/**
 * One clock tick. Returns the next state and whether to start a scan now. A fired scan
 * counts against AUTO_MAX_SCANS; the caller then dispatches "start" and "finish".
 */
export function autoScanTick(state: AutoScanState, now: number): { state: AutoScanState; fire: boolean } {
  if (!state.on) return { state, fire: false };
  if (state.scansSinceTap >= AUTO_MAX_SCANS) return { state: { ...state, on: false, stopped: "limit" }, fire: false };
  if (now - state.lastTapAt >= AUTO_IDLE_MS) return { state: { ...state, on: false, stopped: "idle" }, fire: false };
  if (!state.live || !state.visible || state.inFlight) return { state, fire: false };
  if (state.lastScanAt !== null && now - state.lastScanAt < AUTO_INTERVAL_MS) return { state, fire: false };
  return { state: { ...state, scansSinceTap: state.scansSinceTap + 1 }, fire: true };
}

/** A plain line for why auto stopped, or null. */
export function autoStopMessage(reason: AutoStopReason | null): string | null {
  switch (reason) {
    case "limit":
      return `Auto stopped after ${AUTO_MAX_SCANS} scans. Turn it on again to keep going.`;
    case "idle":
      return "Auto stopped because the screen was not touched for 2 minutes.";
    case null:
      return null;
  }
}
