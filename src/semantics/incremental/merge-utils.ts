export interface RangeLike {
  readonly from: number;
  readonly to: number;
}

export interface PositionMapper {
  mapPos(pos: number, assoc?: number): number;
}

export function mapRangeObject<T extends RangeLike>(
  value: T,
  changes: PositionMapper,
): T {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  if (from === value.from && to === value.to) return value;
  return {
    ...value,
    from,
    to,
  } as T;
}

/**
 * Treat zero-length ranges as mapped artifacts from removed semantic values.
 * Those points should be removed when they land on a dirty-window boundary.
 */
export function rangesOverlap(value: RangeLike, window: RangeLike): boolean {
  if (value.from === value.to) {
    if (window.from === window.to) return value.from === window.from;
    return value.from >= window.from && value.from <= window.to;
  }

  if (window.from === window.to) {
    return value.from < window.from && window.from < value.to;
  }

  return value.from < window.to && window.from < value.to;
}

function lowerBoundByTo<T extends RangeLike>(
  values: readonly T[],
  target: number,
): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid].to < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lowerBoundByFrom<T extends RangeLike>(
  values: readonly T[],
  target: number,
): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid].from < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * `values` must already be sorted and non-overlapping in the same coordinate
 * space as `window`.
 */
export function firstOverlapIndex<T extends RangeLike>(
  values: readonly T[],
  window: RangeLike,
): number {
  const index = lowerBoundByTo(values, window.from);
  for (let current = index; current < values.length; current++) {
    if (values[current].from > window.to) return -1;
    if (rangesOverlap(values[current], window)) return current;
  }
  return -1;
}

/**
 * `values` and `replacements` must already be sorted and non-overlapping in
 * the same coordinate space as `window`.
 */
export function replaceOverlappingRanges<T extends RangeLike>(
  values: readonly T[],
  window: RangeLike,
  replacements: readonly T[],
): readonly T[] {
  const overlapIndex = firstOverlapIndex(values, window);
  const start = overlapIndex === -1
    ? lowerBoundByFrom(values, window.from)
    : overlapIndex;

  let end = start;
  while (end < values.length && rangesOverlap(values[end], window)) {
    end++;
  }

  if (start === end && replacements.length === 0) return values;

  return [
    ...values.slice(0, start),
    ...replacements,
    ...values.slice(end),
  ];
}
