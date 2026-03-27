import type { Tree } from "@lezer/common";
import type { FencedDivSemantics } from "../../document";
import {
  firstOverlapIndex,
  rangesOverlap,
  replaceOverlappingRanges,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow } from "../types";
import {
  extractStructuralWindow,
  type StructuralWindowExtraction,
} from "../window-extractor";
import type { TextSource } from "../../document";

export interface ExtractedDirtyStructuralWindow {
  readonly window: DirtyWindow;
  readonly range: { from: number; to: number };
  readonly structural: StructuralWindowExtraction;
}

interface OverlapSpan {
  readonly start: number;
  readonly end: number;
}

function mapSentinelPos(
  pos: number,
  changes: PositionMapper,
  assoc: number,
): number {
  return pos < 0 ? pos : changes.mapPos(pos, assoc);
}

function mapOptionalPos(
  pos: number | undefined,
  changes: PositionMapper,
  assoc: number,
): number | undefined {
  return pos === undefined ? undefined : changes.mapPos(pos, assoc);
}

export function mapFencedDivSemantics(
  value: FencedDivSemantics,
  changes: PositionMapper,
): FencedDivSemantics {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  const openFenceFrom = changes.mapPos(value.openFenceFrom, 1);
  const openFenceTo = Math.max(openFenceFrom, changes.mapPos(value.openFenceTo, -1));
  const attrFrom = mapOptionalPos(value.attrFrom, changes, 1);
  const attrToBase = mapOptionalPos(value.attrTo, changes, -1);
  const attrTo =
    attrFrom === undefined || attrToBase === undefined
      ? attrToBase
      : Math.max(attrFrom, attrToBase);
  const titleFrom = mapOptionalPos(value.titleFrom, changes, 1);
  const titleToBase = mapOptionalPos(value.titleTo, changes, -1);
  const titleTo =
    titleFrom === undefined || titleToBase === undefined
      ? titleToBase
      : Math.max(titleFrom, titleToBase);
  const closeFenceFrom = mapSentinelPos(value.closeFenceFrom, changes, 1);
  const closeFenceToBase = mapSentinelPos(value.closeFenceTo, changes, -1);
  const closeFenceTo =
    closeFenceFrom < 0 || closeFenceToBase < 0
      ? closeFenceToBase
      : Math.max(closeFenceFrom, closeFenceToBase);

  if (
    from === value.from
    && to === value.to
    && openFenceFrom === value.openFenceFrom
    && openFenceTo === value.openFenceTo
    && attrFrom === value.attrFrom
    && attrTo === value.attrTo
    && titleFrom === value.titleFrom
    && titleTo === value.titleTo
    && closeFenceFrom === value.closeFenceFrom
    && closeFenceTo === value.closeFenceTo
  ) {
    return value;
  }

  return {
    ...value,
    from,
    to,
    openFenceFrom,
    openFenceTo,
    attrFrom,
    attrTo,
    titleFrom,
    titleTo,
    closeFenceFrom,
    closeFenceTo,
  };
}

function findOverlappingOldSpan(
  previous: readonly FencedDivSemantics[],
  window: DirtyWindow,
): OverlapSpan | null {
  const oldWindow = { from: window.fromOld, to: window.toOld };
  const start = firstOverlapIndex(previous, oldWindow);
  if (start === -1) return null;

  let end = start;
  while (end < previous.length && rangesOverlap(previous[end], oldWindow)) {
    end++;
  }

  return { start, end };
}

function findOverlapSpan(
  values: readonly FencedDivSemantics[],
  window: { from: number; to: number },
): OverlapSpan | null {
  const start = firstOverlapIndex(values, window);
  if (start === -1) return null;

  let end = start;
  while (end < values.length && rangesOverlap(values[end], window)) {
    end++;
  }

  return { start, end };
}

function findTouchingStartSpan(
  values: readonly FencedDivSemantics[],
  pos: number,
): OverlapSpan | null {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid].from < pos) lo = mid + 1;
    else hi = mid;
  }

  if (lo >= values.length || values[lo].from !== pos) {
    return null;
  }

  return { start: lo, end: lo + 1 };
}

function expandRange(
  range: { from: number; to: number },
  from: number,
  to: number,
): { from: number; to: number } {
  return {
    from: Math.min(range.from, from),
    to: Math.max(range.to, to),
  };
}

export function extractDirtyFencedDivWindows(
  previous: readonly FencedDivSemantics[],
  doc: TextSource,
  tree: Tree,
  changes: PositionMapper,
  dirtyWindows: readonly DirtyWindow[],
): readonly ExtractedDirtyStructuralWindow[] {
  const mappedPrevious = previous.map((div) => mapFencedDivSemantics(div, changes));

  return dirtyWindows.map((window) => {
    let range = { from: window.fromNew, to: window.toNew };
    const oldSpan = findOverlappingOldSpan(previous, window);
    if (oldSpan) {
      range = expandRange(
        range,
        mappedPrevious[oldSpan.start].from,
        mappedPrevious[oldSpan.end - 1].to,
      );
    }

    let structural = extractStructuralWindow(doc, tree, range);
    while (true) {
      let nextRange = range;
      if (structural.fencedDivs.length > 0) {
        nextRange = expandRange(
          nextRange,
          structural.fencedDivs[0].from,
          structural.fencedDivs[structural.fencedDivs.length - 1].to,
        );
      }

      const mappedSpan = findOverlapSpan(mappedPrevious, nextRange);
      if (mappedSpan) {
        nextRange = expandRange(
          nextRange,
          mappedPrevious[mappedSpan.start].from,
          mappedPrevious[mappedSpan.end - 1].to,
        );
      } else {
        const touchingStartSpan = findTouchingStartSpan(mappedPrevious, nextRange.to);
        if (touchingStartSpan) {
          nextRange = expandRange(
            nextRange,
            mappedPrevious[touchingStartSpan.start].from,
            mappedPrevious[touchingStartSpan.end - 1].to,
          );
        }
      }

      if (nextRange.from === range.from && nextRange.to === range.to) {
        return {
          window,
          range,
          structural,
        };
      }

      range = nextRange;
      structural = extractStructuralWindow(doc, tree, range);
    }
  });
}

export function mergeFencedDivSlice(
  previous: readonly FencedDivSemantics[],
  changes: PositionMapper,
  extractedDirtyWindows: readonly ExtractedDirtyStructuralWindow[],
): readonly FencedDivSemantics[] {
  let merged: readonly FencedDivSemantics[] =
    previous.map((div) => mapFencedDivSemantics(div, changes));

  for (let i = extractedDirtyWindows.length - 1; i >= 0; i--) {
    const { range, structural } = extractedDirtyWindows[i];
    merged = replaceOverlappingRanges(
      merged,
      range,
      structural.fencedDivs,
    );
  }

  return merged;
}
