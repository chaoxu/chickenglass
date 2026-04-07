import type { ChangeDesc } from "@codemirror/state";

/** A snapshot of a visible document range (matches CM6 visibleRanges shape). */
export interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Compute the fragments of `newRanges` not covered by `oldRanges`.
 *
 * Both inputs must be sorted by `from` and non-overlapping.
 */
export function diffVisibleRanges(
  oldRanges: readonly VisibleRange[],
  newRanges: readonly VisibleRange[],
): VisibleRange[] {
  const result: VisibleRange[] = [];
  let oldIndex = 0;

  for (const nextRange of newRanges) {
    let cursor = nextRange.from;

    while (oldIndex < oldRanges.length && oldRanges[oldIndex].to <= cursor) {
      oldIndex++;
    }

    for (
      let scanIndex = oldIndex;
      scanIndex < oldRanges.length && oldRanges[scanIndex].from < nextRange.to;
      scanIndex++
    ) {
      const previousRange = oldRanges[scanIndex];
      if (previousRange.from > cursor) {
        result.push({ from: cursor, to: previousRange.from });
      }
      cursor = Math.max(cursor, previousRange.to);
      if (cursor >= nextRange.to) break;
    }

    if (cursor < nextRange.to) {
      result.push({ from: cursor, to: nextRange.to });
    }
  }

  return result;
}

/** Check whether a document position falls inside any of the given sorted ranges. */
export function isPositionInRanges(
  pos: number,
  ranges: readonly VisibleRange[],
): boolean {
  for (const range of ranges) {
    if (pos >= range.from && pos < range.to) return true;
    if (range.from > pos) break;
  }
  return false;
}

/**
 * Clamp a dirty range to the document and widen zero-length updates to a
 * one-character window when the document is non-empty.
 */
export function normalizeDirtyRange(
  from: number,
  to: number,
  docLength: number,
): VisibleRange {
  const start = Math.max(0, Math.min(from, docLength));
  const end = Math.max(0, Math.min(to, docLength));
  if (start !== end) {
    return start < end ? { from: start, to: end } : { from: end, to: start };
  }
  if (docLength === 0) {
    return { from: 0, to: 0 };
  }
  const windowStart = Math.max(0, Math.min(start, docLength - 1));
  return { from: windowStart, to: Math.min(docLength, windowStart + 1) };
}

/** Map sorted ranges through document changes. */
export function mapVisibleRanges(
  ranges: readonly VisibleRange[],
  changes: ChangeDesc,
): VisibleRange[] {
  return mergeRanges(
    ranges.map((range) => {
      const from = changes.mapPos(range.from, 1);
      const to = changes.mapPos(range.to, -1);
      return { from, to: Math.max(from, to) };
    }),
  );
}

/** Check whether a range overlaps any of the given sorted ranges. */
export function rangeIntersectsRanges(
  from: number,
  to: number,
  ranges: readonly VisibleRange[],
): boolean {
  for (const range of ranges) {
    if (from === to) {
      if (from >= range.from && from < range.to) return true;
      if (range.from > from) break;
      continue;
    }
    if (from < range.to && to > range.from) return true;
    if (range.from >= to) break;
  }
  return false;
}

/** Merge overlapping ranges into a minimal sorted set. */
export function mergeRanges(
  ranges: readonly VisibleRange[],
  adjacency = 0,
): VisibleRange[] {
  if (ranges.length <= 1) return [...ranges];
  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  const merged: VisibleRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.from <= last.to + adjacency) {
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

/** Snapshot CM6's live visibleRanges into a plain array of {from, to}. */
export function snapshotRanges(
  ranges: readonly { from: number; to: number }[],
): VisibleRange[] {
  return ranges.map((range) => ({ from: range.from, to: range.to }));
}
