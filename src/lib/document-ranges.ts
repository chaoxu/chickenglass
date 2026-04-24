import type { ChangeDesc, ChangeSet, Text } from "@codemirror/state";

export interface DocumentRange {
  readonly from: number;
  readonly to: number;
}

export type DocumentRangeExpander = (from: number, to: number) => DocumentRange;

export function containsDocumentPosition(
  range: Pick<DocumentRange, "from" | "to">,
  pos: number,
): boolean {
  return pos >= range.from && pos < range.to;
}

export function documentRangesIntersect(
  left: Pick<DocumentRange, "from" | "to">,
  right: Pick<DocumentRange, "from" | "to">,
): boolean {
  return left.from < right.to && right.from < left.to;
}

export function mergeDocumentRanges(
  ranges: readonly DocumentRange[],
  adjacency = 0,
): DocumentRange[] {
  if (ranges.length <= 1) return [...ranges];
  const sorted = [...ranges].sort((left, right) =>
    left.from - right.from || left.to - right.to
  );
  const merged: DocumentRange[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const last = merged[merged.length - 1];
    const current = sorted[index];
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

export function normalizeDocumentRange(
  from: number,
  to: number,
  docLength: number,
): DocumentRange {
  const start = Math.max(0, Math.min(from, docLength));
  const end = Math.max(0, Math.min(to, docLength));
  return start <= end
    ? { from: start, to: end }
    : { from: end, to: start };
}

export function normalizeDirtyDocumentRange(
  from: number,
  to: number,
  docLength: number,
): DocumentRange {
  const range = normalizeDocumentRange(from, to, docLength);
  if (range.from !== range.to || docLength === 0) {
    return range;
  }

  const windowStart = Math.max(0, Math.min(range.from, docLength - 1));
  return { from: windowStart, to: Math.min(docLength, windowStart + 1) };
}

export function documentRangesFromChanges(
  changes: ChangeSet,
  expandRange: DocumentRangeExpander,
): DocumentRange[] {
  const ranges: DocumentRange[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    ranges.push(expandRange(fromB, toB));
  });
  return mergeDocumentRanges(ranges);
}

export function expandChangedDocumentRange(
  from: number,
  to: number,
): DocumentRange {
  return { from, to: Math.max(from, to) };
}

export function expandChangedDocumentRangeToLines(
  doc: Text,
  from: number,
  to: number,
): DocumentRange {
  const startLine = doc.lineAt(from);
  const endAnchor = Math.max(from, to);
  const endLine = doc.lineAt(Math.min(endAnchor, doc.length)).to;
  return { from: startLine.from, to: endLine };
}

export function mapDocumentRanges(
  ranges: readonly DocumentRange[],
  changes: ChangeDesc,
): DocumentRange[] {
  return mergeDocumentRanges(
    ranges.map((range) => {
      const from = changes.mapPos(range.from, 1);
      const to = changes.mapPos(range.to, -1);
      return { from, to: Math.max(from, to) };
    }),
  );
}

export function positionInDocumentRanges(
  pos: number,
  ranges: readonly DocumentRange[],
): boolean {
  for (const range of ranges) {
    if (containsDocumentPosition(range, pos)) return true;
    if (range.from > pos) break;
  }
  return false;
}

export function rangeIntersectsDocumentRanges(
  from: number,
  to: number,
  ranges: readonly DocumentRange[],
): boolean {
  const target = { from, to };
  for (const range of ranges) {
    if (from === to) {
      if (containsDocumentPosition(range, from)) return true;
      if (range.from > from) break;
      continue;
    }
    if (documentRangesIntersect(target, range)) return true;
    if (range.from >= to) break;
  }
  return false;
}

export function snapshotDocumentRanges(
  ranges: readonly { from: number; to: number }[],
): DocumentRange[] {
  return ranges.map((range) => ({ from: range.from, to: range.to }));
}
