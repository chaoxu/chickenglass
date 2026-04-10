import type { Tree } from "@lezer/common";
import type { FencedDivSemantics } from "../../document";
import {
  rangesOverlap,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow } from "../types";
import {
  extractFencedDivExpansionWindow,
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

function spanRange(
  values: readonly FencedDivSemantics[],
  span: OverlapSpan,
): { from: number; to: number } {
  let to = values[span.start].to;
  for (let i = span.start + 1; i < span.end; i++) {
    to = Math.max(to, values[i].to);
  }
  return { from: values[span.start].from, to };
}

function findAffectedSpan(
  values: readonly FencedDivSemantics[],
  window: { from: number; to: number },
  includeTouchingStart: boolean,
): OverlapSpan | null {
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    if (
      rangesOverlap(values[i], window)
      || (includeTouchingStart && values[i].from === window.to)
    ) {
      start = i;
      break;
    }
    if (values[i].from > window.to) break;
  }

  if (start === -1) {
    return null;
  }

  let end = start + 1;
  let maxTo = values[start].to;
  while (end < values.length) {
    const value = values[end];
    if (
      !(value.from < maxTo
        || rangesOverlap(value, window)
        || (includeTouchingStart && value.from === window.to))
    ) {
      break;
    }
    maxTo = Math.max(maxTo, value.to);
    end++;
  }

  return { start, end };
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
    const oldSpan = findAffectedSpan(
      previous,
      { from: window.fromOld, to: window.toOld },
      false,
    );
    if (oldSpan) {
      const oldRange = spanRange(mappedPrevious, oldSpan);
      range = expandRange(range, oldRange.from, oldRange.to);
    }

    let expansion = extractFencedDivExpansionWindow(doc, tree, range);
    while (true) {
      let nextRange = range;
      if (expansion.fencedDivs.length > 0) {
        const structuralSpan = spanRange(expansion.fencedDivs, {
          start: 0,
          end: expansion.fencedDivs.length,
        });
        nextRange = expandRange(nextRange, structuralSpan.from, structuralSpan.to);
      }

      for (const math of expansion.mathRegions) {
        if (math.isDisplay && math.from < nextRange.to && nextRange.from < math.to) {
          nextRange = expandRange(nextRange, math.from, math.to);
        }
      }

      const mappedSpan = findAffectedSpan(mappedPrevious, nextRange, true);
      if (mappedSpan) {
        const mappedRange = spanRange(mappedPrevious, mappedSpan);
        nextRange = expandRange(nextRange, mappedRange.from, mappedRange.to);
      }

      if (nextRange.from === range.from && nextRange.to === range.to) {
        return {
          window,
          range,
          structural: extractStructuralWindow(doc, tree, range, {
            includeNarrativeRefs: false,
          }),
        };
      }

      range = nextRange;
      expansion = extractFencedDivExpansionWindow(doc, tree, range);
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
    const span = findAffectedSpan(merged, range, false);
    if (!span) {
      let insertAt = merged.length;
      for (let j = 0; j < merged.length; j++) {
        if (merged[j].from >= range.from) {
          insertAt = j;
          break;
        }
      }
      merged = [
        ...merged.slice(0, insertAt),
        ...structural.fencedDivs,
        ...merged.slice(insertAt),
      ];
      continue;
    }

    merged = [
      ...merged.slice(0, span.start),
      ...structural.fencedDivs,
      ...merged.slice(span.end),
    ];
  }

  return merged;
}
