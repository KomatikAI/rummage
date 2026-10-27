import { cn, formatMoney } from "@/components/ui";

import { progressSegments } from "./progress";

/** The fundraiser strip: ten separate segments, filled step by step, never a smooth bar. */
export function SegmentedProgress({ raised, goal }: { raised: number; goal: number | null }) {
  const progress = progressSegments(raised, goal);
  const summary =
    progress.percent === null
      ? `${formatMoney(raised)} raised. No goal set.`
      : `${formatMoney(raised)} raised of a ${formatMoney(goal ?? 0)} goal, ${progress.percent} percent.`;
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden="true" className="grid grid-cols-10 gap-1">
        {progress.segments.map((filled, index) => (
          <span
            key={index}
            className={cn("h-3 rounded-pill", filled ? (progress.reached ? "bg-ready" : "bg-accent") : "bg-grey-200")}
          />
        ))}
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  );
}
