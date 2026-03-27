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

function getExtractionWindow(
  previous: readonly FencedDivSemantics[],
  changes: PositionMapper,
  window: DirtyWindow,
): { from: number; to: number } {
  const span = findOverlappingOldSpan(previous, window);
  if (!span) {
    return { from: window.fromNew, to: window.toNew };
  }

  const first = mapFencedDivSemantics(previous[span.start], changes);
  const last = mapFencedDivSemantics(previous[span.end - 1], changes);

  return {
    from: Math.min(window.fromNew, first.from),
    to: Math.max(window.toNew, last.to),
  };
}

export function extractDirtyFencedDivWindows(
  previous: readonly FencedDivSemantics[],
  doc: TextSource,
  tree: Tree,
  changes: PositionMapper,
  dirtyWindows: readonly DirtyWindow[],
): readonly ExtractedDirtyStructuralWindow[] {
  return dirtyWindows.map((window) => ({
    window,
    structural: extractStructuralWindow(
      doc,
      tree,
      getExtractionWindow(previous, changes, window),
    ),
  }));
}

export function mergeFencedDivSlice(
  previous: readonly FencedDivSemantics[],
  changes: PositionMapper,
  extractedDirtyWindows: readonly ExtractedDirtyStructuralWindow[],
): readonly FencedDivSemantics[] {
  let merged: readonly FencedDivSemantics[] =
    previous.map((div) => mapFencedDivSemantics(div, changes));

  for (let i = extractedDirtyWindows.length - 1; i >= 0; i--) {
    const { window, structural } = extractedDirtyWindows[i];
    const span = findOverlappingOldSpan(previous, window);

    if (span) {
      const { start, end } = span;

      merged = [
        ...merged.slice(0, start),
        ...structural.fencedDivs,
        ...merged.slice(end),
      ];
      continue;
    }

    merged = replaceOverlappingRanges(
      merged,
      { from: window.fromNew, to: window.toNew },
      structural.fencedDivs,
    );
  }

  return merged;
}
