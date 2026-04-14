import { memo, type RefObject } from "react";

import { formatReadingTime, type DocStats } from "../writing-stats";
import { StatusBarPopover } from "./status-bar-popover";

interface StatsPopoverProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly stats: DocStats;
}

export const StatsPopover = memo(function StatsPopover({
  anchorRef,
  onClose,
  stats,
}: StatsPopoverProps) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Words", stats.words.toLocaleString()],
    ["Characters", stats.chars.toLocaleString()],
    ["Without spaces", stats.charsNoSpaces.toLocaleString()],
    ["Sentences", stats.sentences.toLocaleString()],
    ["Reading time", formatReadingTime(stats.readingMinutes)],
  ];

  return (
    <StatusBarPopover anchorRef={anchorRef} onClose={onClose} align="left" ariaLabel="Writing statistics" minWidth="200px">
      <div className="font-semibold text-sm mb-2 text-[var(--cf-fg)]">
        Writing Statistics
      </div>
      <div className="flex flex-col gap-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-6">
            <span className="text-[var(--cf-muted)]">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </StatusBarPopover>
  );
});
