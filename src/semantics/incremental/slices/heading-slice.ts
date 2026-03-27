import type { HeadingSemantics } from "../../document";
import {
  firstOverlapIndex,
  mapRangeObject,
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

  const parts: number[] = [];
  for (let level = 1; level <= heading.level; level++) {
    if (counters[level] !== 0) {
      parts.push(counters[level]);
    }
  }
  return parts.join(".");
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
  changes: PositionMapper,
): readonly HeadingSemantics[] {
  let changed = false;
  const mapped = headings.map((heading) => {
    const next = mapHeadingSemantics(heading, changes);
    if (next !== heading) changed = true;
    return next;
  });
  return changed ? mapped : headings;
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

export function mapHeadingSemantics(
  value: HeadingSemantics,
  changes: PositionMapper,
): HeadingSemantics {
  return mapRangeObject(value, changes);
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
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyHeadingWindowExtraction[],
): HeadingSlice {
  let headings: readonly HeadingStructure[] = mapHeadings(
    previous.headings,
    deltaMapper(delta),
  );
  let earliestAffectedIndex = Number.POSITIVE_INFINITY;

  for (const { window, structural } of dirtyExtractions) {
    const mergeWindow = { from: window.fromNew, to: window.toNew };
    const startIndex = replacementStartIndex(headings, mergeWindow);
    const replacementHeadings = structural.headings.filter((heading) =>
      rangesOverlap(heading, mergeWindow)
    );
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
