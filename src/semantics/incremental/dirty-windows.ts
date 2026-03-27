import type { DirtyWindow, RawChangedRange } from "./types";

export const DEFAULT_DIRTY_WINDOW_GAP = 32;

function compareRanges(a: RawChangedRange, b: RawChangedRange): number {
  return (
    a.fromOld - b.fromOld
    || a.fromNew - b.fromNew
    || a.toOld - b.toOld
    || a.toNew - b.toNew
  );
}

function canMerge(
  current: DirtyWindow,
  next: RawChangedRange,
  gap: number,
): boolean {
  const oldGap = next.fromOld - current.toOld;
  const newGap = next.fromNew - current.toNew;
  return oldGap <= gap && newGap <= gap;
}

export function coalesceChangedRanges(
  ranges: readonly RawChangedRange[],
  gap: number = DEFAULT_DIRTY_WINDOW_GAP,
): DirtyWindow[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort(compareRanges);
  const windows: DirtyWindow[] = [];

  for (const range of sorted) {
    const current = windows[windows.length - 1];
    if (!current || !canMerge(current, range, gap)) {
      windows.push({ ...range });
      continue;
    }

    windows[windows.length - 1] = {
      fromOld: current.fromOld,
      toOld: Math.max(current.toOld, range.toOld),
      fromNew: current.fromNew,
      toNew: Math.max(current.toNew, range.toNew),
    };
  }

  return windows;
}
