import {
  mapDocumentRanges,
  mergeDocumentRanges,
  normalizeDirtyDocumentRange,
  positionInDocumentRanges,
  rangeIntersectsDocumentRanges,
  snapshotDocumentRanges,
  type DocumentRange,
} from "../lib/document-ranges";

/** A snapshot of a visible document range (matches CM6 visibleRanges shape). */
export type VisibleRange = DocumentRange;

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
  return positionInDocumentRanges(pos, ranges);
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
  return normalizeDirtyDocumentRange(from, to, docLength);
}

/** Map sorted ranges through document changes. */
export const mapVisibleRanges = mapDocumentRanges;

/** Check whether a range overlaps any of the given sorted ranges. */
export function rangeIntersectsRanges(
  from: number,
  to: number,
  ranges: readonly VisibleRange[],
): boolean {
  return rangeIntersectsDocumentRanges(from, to, ranges);
}

/** Snapshot CM6's live visibleRanges into a plain array of {from, to}. */
export function snapshotRanges(
  ranges: readonly { from: number; to: number }[],
): VisibleRange[] {
  return snapshotDocumentRanges(ranges);
}

export { mergeDocumentRanges as mergeRanges };
