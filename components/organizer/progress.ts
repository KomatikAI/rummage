/**
 * The fundraiser progress strip: a fixed number of segments, each filled or not, so
 * progress reads as steps rather than a continuous bar.
 */

export const DEFAULT_SEGMENTS = 10;

export interface ProgressSegments {
  /** One entry per segment, true when filled. */
  segments: boolean[];
  filled: number;
  /** Whole percent of the goal (may pass 100), or null when there is no goal. */
  percent: number | null;
  reached: boolean;
}

/**
 * Splits `raised` of `goal` into `total` segments. Any money raised fills at least one
 * segment, so a first donation is always visible; a segment is only filled once its
 * share of the goal is fully covered otherwise. No goal (null or not positive) leaves
 * every segment empty.
 */
export function progressSegments(raised: number, goal: number | null, total = DEFAULT_SEGMENTS): ProgressSegments {
  const count = Math.max(1, Math.floor(total));
  const safeRaised = Number.isFinite(raised) && raised > 0 ? raised : 0;
  if (goal === null || !Number.isFinite(goal) || goal <= 0) {
    return { segments: Array<boolean>(count).fill(false), filled: 0, percent: null, reached: false };
  }
  const ratio = safeRaised / goal;
  let filled = Math.min(count, Math.floor(ratio * count + 1e-9));
  if (safeRaised > 0 && filled === 0) filled = 1;
  return {
    segments: Array.from({ length: count }, (_, index) => index < filled),
    filled,
    percent: Math.floor(ratio * 100 + 1e-9),
    reached: safeRaised >= goal,
  };
}
