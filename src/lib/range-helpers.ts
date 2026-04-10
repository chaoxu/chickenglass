import type { Text } from "@codemirror/state";

export interface RangeLike {
  readonly from: number;
  readonly to: number;
}

export interface OrderedRange extends RangeLike {}

const orderedRangePrefixMaxToCache = new WeakMap<
  readonly OrderedRange[],
  readonly number[]
>();
const mergedRangeCoverageCache = new WeakMap<
  readonly OrderedRange[],
  readonly OrderedRange[]
>();

export function containsPos(
  range: Pick<RangeLike, "from" | "to">,
  pos: number,
): boolean {
  return pos >= range.from && pos <= range.to;
}

export function containsRange(
  outer: Pick<RangeLike, "from" | "to">,
  inner: Pick<RangeLike, "from" | "to">,
): boolean {
  return inner.from >= outer.from && inner.to <= outer.to;
}

export function rangesOverlap(
  left: Pick<RangeLike, "from" | "to">,
  right: Pick<RangeLike, "from" | "to">,
): boolean {
  return left.from <= right.to && right.from <= left.to;
}

export function containsPosExclusiveEnd(
  range: Pick<RangeLike, "from" | "to">,
  pos: number,
): boolean {
  return pos >= range.from && pos < range.to;
}

export function rangesIntersect(
  left: Pick<RangeLike, "from" | "to">,
  right: Pick<RangeLike, "from" | "to">,
): boolean {
  return left.from < right.to && right.from < left.to;
}

export function toRanges<T extends RangeLike>(
  items: readonly T[],
): RangeLike[] {
  return items.map((item) => ({ from: item.from, to: item.to }));
}

export function clampDocPos(doc: Text, pos: number): number {
  return Math.max(0, Math.min(pos, doc.length));
}

export function expandRangeToLineBounds(
  doc: Text,
  from: number,
  to: number,
): RangeLike {
  if (doc.length === 0) {
    return { from: 0, to: 0 };
  }

  const clampedFrom = clampDocPos(doc, from);
  const clampedTo = clampDocPos(doc, Math.max(from, to));

  return {
    from: doc.lineAt(clampedFrom).from,
    to: doc.lineAt(clampedTo).to,
  };
}

export function expandChangeQueryRange(
  doc: Text,
  from: number,
  to: number,
): RangeLike {
  if (doc.length === 0) {
    return { from: 0, to: 0 };
  }

  return expandRangeToLineBounds(
    doc,
    from > 0 ? from - 1 : from,
    to < doc.length ? to + 1 : to,
  );
}

export function getOrderedRangePrefixMaxTo<T extends OrderedRange>(
  values: readonly T[],
): readonly number[] {
  const cached = orderedRangePrefixMaxToCache.get(values);
  if (cached) return cached;

  const prefixMaxTo = new Array<number>(values.length);
  let maxTo = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < values.length; index += 1) {
    maxTo = Math.max(maxTo, values[index].to);
    prefixMaxTo[index] = maxTo;
  }

  orderedRangePrefixMaxToCache.set(values, prefixMaxTo);
  return prefixMaxTo;
}

function firstPotentialOverlapIndex<T extends OrderedRange>(
  values: readonly T[],
  range: Pick<RangeLike, "from" | "to">,
): number {
  if (values.length === 0) {
    return -1;
  }

  const prefixMaxTo = getOrderedRangePrefixMaxTo(values);
  let lo = 0;
  let hi = prefixMaxTo.length;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (prefixMaxTo[mid] < range.from) lo = mid + 1;
    else hi = mid;
  }

  return lo < values.length ? lo : -1;
}

export function forEachOverlappingOrderedRange<T extends OrderedRange>(
  values: readonly T[],
  range: Pick<RangeLike, "from" | "to">,
  visit: (value: T) => void,
): void {
  const startIndex = firstPotentialOverlapIndex(values, range);
  if (startIndex === -1) {
    return;
  }

  for (let index = startIndex; index < values.length; index += 1) {
    const value = values[index];
    if (value.from > range.to) {
      break;
    }
    if (!rangesOverlap(value, range)) {
      continue;
    }
    visit(value);
  }
}

export function collectOverlappingOrderedRanges<T extends OrderedRange>(
  values: readonly T[],
  range: Pick<RangeLike, "from" | "to">,
): readonly T[] {
  const overlaps: T[] = [];
  forEachOverlappingOrderedRange(values, range, (value) => {
    overlaps.push(value);
  });
  return overlaps;
}

export function getMergedRangeCoverage(
  values: readonly OrderedRange[],
): readonly OrderedRange[] {
  const cached = mergedRangeCoverageCache.get(values);
  if (cached) return cached;
  if (values.length === 0) {
    return values;
  }

  const coverage: OrderedRange[] = [];
  let currentFrom = values[0].from;
  let currentTo = values[0].to;

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    // Ordered coverage merges when the next range starts at or before the
    // current inclusive end, matching the previous `value.from <= currentTo`.
    if (containsPos({ from: currentFrom, to: currentTo }, value.from)) {
      currentTo = Math.max(currentTo, value.to);
      continue;
    }

    coverage.push({ from: currentFrom, to: currentTo });
    currentFrom = value.from;
    currentTo = value.to;
  }

  coverage.push({ from: currentFrom, to: currentTo });
  mergedRangeCoverageCache.set(values, coverage);
  return coverage;
}

/** Merge overlapping ranges into a minimal sorted set. */
export function mergeRanges(
  ranges: readonly RangeLike[],
  adjacency = 0,
): RangeLike[] {
  if (ranges.length <= 1) return [...ranges];
  const sorted = [...ranges].sort((left, right) => left.from - right.from);
  const merged: RangeLike[] = [sorted[0]];
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
