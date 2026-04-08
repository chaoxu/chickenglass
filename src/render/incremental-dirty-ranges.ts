import type { ChangeSet, Text } from "@codemirror/state";

export interface DirtyRange {
  readonly from: number;
  readonly to: number;
}

export type DirtyRangeExpander = (from: number, to: number) => DirtyRange;

export function mergeDirtyRanges(ranges: readonly DirtyRange[]): DirtyRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: DirtyRange[] = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.from <= last.to) {
      merged[merged.length - 1] = {
        from: last.from,
        to: Math.max(last.to, current.to),
      };
      continue;
    }
    merged.push(current);
  }
  return merged;
}

export function dirtyRangesFromChanges(
  changes: ChangeSet,
  expandRange: DirtyRangeExpander,
): DirtyRange[] {
  const ranges: DirtyRange[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    ranges.push(expandRange(fromB, toB));
  });
  return mergeDirtyRanges(ranges);
}

export function expandChangeRange(
  from: number,
  to: number,
): DirtyRange {
  return { from, to: Math.max(from, to) };
}

export function expandChangeRangeToLines(
  doc: Text,
  from: number,
  to: number,
): DirtyRange {
  const startLine = doc.lineAt(from);
  const endAnchor = Math.max(from, to);
  const endLine = doc.lineAt(Math.min(endAnchor, doc.length)).to;
  return { from: startLine.from, to: endLine };
}

export function rangeIntersectsDirtyRanges(
  from: number,
  to: number,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  for (const range of dirtyRanges) {
    if (from < range.to && to > range.from) return true;
    if (range.from >= to) break;
  }
  return false;
}
