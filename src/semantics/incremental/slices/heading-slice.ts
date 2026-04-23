import type { HeadingSemantics } from "../../document-model";
import {
  firstOverlapIndex,
  rangesOverlap,
  replaceOverlappingRanges,
  type RangeLike,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type {
  HeadingStructure,
  StructuralWindowExtraction,
} from "../window-extractor";

export interface HeadingSlice {
  readonly headings: readonly HeadingSemantics[];
  readonly headingByFrom: ReadonlyMap<number, HeadingSemantics>;
}

export interface DirtyHeadingWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "headings">;
}

function buildHeadingByFrom(
  headings: readonly HeadingSemantics[],
): ReadonlyMap<number, HeadingSemantics> {
  return new Map(headings.map((heading) => [heading.from, heading]));
}

function isFinalizedHeading(
  heading: HeadingStructure,
): heading is HeadingSemantics {
  return "number" in heading;
}

function nextHeadingNumber(
  heading: Pick<HeadingStructure, "level" | "unnumbered">,
  counters: number[],
): string {
  if (heading.unnumbered) {
    return "";
  }

  counters[heading.level]++;
  for (let level = heading.level + 1; level <= 6; level++) {
    counters[level] = 0;
  }

  return counters.slice(1, heading.level + 1).join(".");
}

function finalizeHeading(
  heading: HeadingStructure,
  number: string,
): HeadingSemantics {
  if (isFinalizedHeading(heading) && heading.number === number) {
    return heading;
  }

  return {
    ...heading,
    number,
  };
}

function lowerBoundByFrom(
  values: readonly RangeLike[],
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

function replacementStartIndex(
  headings: readonly HeadingStructure[],
  window: RangeLike,
): number {
  const overlapIndex = firstOverlapIndex(headings, window);
  return overlapIndex === -1
    ? lowerBoundByFrom(headings, window.from)
    : overlapIndex;
}

function mapHeadings(
  headings: readonly HeadingSemantics[],
  delta: Pick<SemanticDelta, "mapOldToNew" | "rawChangedRanges">,
): readonly HeadingSemantics[] {
  if (headings.length === 0 || delta.rawChangedRanges.length === 0) {
    return headings;
  }

  const changes = deltaMapper(delta);
  const shiftedChange = singleChangeShift(delta);
  const firstChanged = firstChangedOldPos(delta);
  let startIndex = 0;
  while (startIndex < headings.length && headings[startIndex].to <= firstChanged) {
    startIndex += 1;
  }

  if (startIndex === headings.length) {
    return headings;
  }

  let changed = false;
  const mapped = startIndex === 0 ? [] : headings.slice(0, startIndex);
  for (let index = startIndex; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = shiftedChange && heading.from >= shiftedChange.toOld
      ? shiftHeadingSemantics(heading, shiftedChange.delta)
      : mapHeadingSemantics(heading, changes);
    if (next !== heading) changed = true;
    mapped.push(next);
  }
  return changed ? mapped : headings;
}

function headingTouchesDirtyWindow(
  heading: HeadingStructure,
  window: RangeLike,
): boolean {
  if (rangesOverlap(heading, window)) {
    return true;
  }

  if (window.from !== window.to) {
    return false;
  }

  return heading.from <= window.from && window.from <= heading.to;
}

function expandMergeWindow(
  window: RangeLike,
  replacements: readonly HeadingStructure[],
): RangeLike {
  if (replacements.length === 0) {
    return window;
  }

  return {
    from: Math.min(window.from, replacements[0].from),
    to: Math.max(window.to, replacements[replacements.length - 1].to),
  };
}

function finalizeHeadingTail(
  headings: readonly HeadingStructure[],
  startIndex: number,
): readonly HeadingSemantics[] {
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const prefix: HeadingSemantics[] = [];

  for (let index = 0; index < startIndex; index++) {
    const heading = headings[index];
    prefix.push(finalizeHeading(heading, nextHeadingNumber(heading, counters)));
  }

  const tail: HeadingSemantics[] = [];

  for (let index = startIndex; index < headings.length; index++) {
    const heading = headings[index];
    tail.push(finalizeHeading(heading, nextHeadingNumber(heading, counters)));
  }

  if (startIndex === 0) {
    return tail;
  }

  return [...prefix, ...tail];
}

function deltaMapper(delta: Pick<SemanticDelta, "mapOldToNew">): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

function singleChangeShift(
  delta: Pick<SemanticDelta, "rawChangedRanges">,
): { readonly fromOld: number; readonly toOld: number; readonly delta: number } | null {
  if (delta.rawChangedRanges.length !== 1) {
    return null;
  }

  const change = delta.rawChangedRanges[0];
  const shift = (change.toNew - change.fromNew) - (change.toOld - change.fromOld);
  if (shift === 0) {
    return null;
  }

  return {
    fromOld: change.fromOld,
    toOld: change.toOld,
    delta: shift,
  };
}

function firstChangedOldPos(
  delta: Pick<SemanticDelta, "rawChangedRanges">,
): number {
  let first = Number.POSITIVE_INFINITY;
  for (const range of delta.rawChangedRanges) {
    if (range.fromOld < first) {
      first = range.fromOld;
    }
  }
  return first;
}

function shiftHeadingSemantics(
  value: HeadingSemantics,
  delta: number,
): HeadingSemantics {
  return {
    from: value.from + delta,
    to: value.to + delta,
    level: value.level,
    text: value.text,
    id: value.id,
    number: value.number,
    unnumbered: value.unnumbered,
  };
}

export function mapHeadingSemantics(
  value: HeadingSemantics,
  changes: PositionMapper,
): HeadingSemantics {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  if (from === value.from && to === value.to) {
    return value;
  }
  return {
    from,
    to,
    level: value.level,
    text: value.text,
    id: value.id,
    number: value.number,
    unnumbered: value.unnumbered,
  };
}

export function createHeadingSlice(
  headings: readonly HeadingSemantics[],
): HeadingSlice {
  return {
    headings,
    headingByFrom: buildHeadingByFrom(headings),
  };
}

export function buildHeadingSlice(
  structural: Pick<StructuralWindowExtraction, "headings">,
): HeadingSlice {
  return createHeadingSlice(finalizeHeadingTail(structural.headings, 0));
}

export function mergeHeadingSlice(
  previous: HeadingSlice,
  delta: Pick<SemanticDelta, "mapOldToNew" | "rawChangedRanges">,
  dirtyExtractions: readonly DirtyHeadingWindowExtraction[],
): HeadingSlice {
  let headings: readonly HeadingStructure[] = mapHeadings(
    previous.headings,
    delta,
  );
  let earliestAffectedIndex = Number.POSITIVE_INFINITY;

  for (const { window, structural } of dirtyExtractions) {
    const rawMergeWindow = { from: window.fromNew, to: window.toNew };
    const replacementHeadings = structural.headings.filter((heading) =>
      headingTouchesDirtyWindow(heading, rawMergeWindow)
    );
    const mergeWindow = expandMergeWindow(rawMergeWindow, replacementHeadings);
    const startIndex = replacementStartIndex(headings, mergeWindow);
    const nextHeadings = replaceOverlappingRanges(
      headings,
      mergeWindow,
      replacementHeadings,
    );

    if (nextHeadings !== headings) {
      earliestAffectedIndex = Math.min(earliestAffectedIndex, startIndex);
      headings = nextHeadings;
    }
  }

  if (earliestAffectedIndex === Number.POSITIVE_INFINITY) {
    if (headings === previous.headings) {
      return previous;
    }
    return createHeadingSlice(headings as readonly HeadingSemantics[]);
  }

  return createHeadingSlice(finalizeHeadingTail(headings, earliestAffectedIndex));
}
