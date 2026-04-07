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

/** Merge overlapping or adjacent ranges into a minimal sorted set. */
export function mergeRanges(ranges: VisibleRange[]): VisibleRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  const merged: VisibleRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
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

/** Snapshot CM6's live visibleRanges into a plain array of {from, to}. */
export function snapshotRanges(
  ranges: readonly { from: number; to: number }[],
): VisibleRange[] {
  return ranges.map((range) => ({ from: range.from, to: range.to }));
}
