import type { Tree } from "@lezer/common";
import type {
  FencedDivSemantics,
  ReferenceSemantics,
  TextSource,
} from "../document-model";
import {
  lowerBoundByTo,
  replaceOverlappingRanges,
  type PositionMapper,
} from "./merge-utils";
import type { NarrativeRefExtraction } from "./slices/reference-slice";
import {
  type ExtractedDirtyStructuralWindow,
  extractDirtyFencedDivWindows,
  mapFencedDivSemantics,
} from "./slices/fenced-div-slice";
import type { IncrementalDocumentAnalysisState } from "./slice-registry";
import type { DirtyWindow, SemanticDelta } from "./types";
import {
  collectNarrativeRefsInWindow,
  computeNarrativeExtractionRange,
  expandRangeToParagraphBoundaries,
  extractInlineStructuralWindow,
  type ExcludedRange,
  type StructuralWindowExtraction,
} from "./window-extractor";

export type StructuralExtractionMode = "skip" | "paragraph" | "full";

export interface DirtyStructuralExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "excludedRanges">;
}

export interface DirtyWindowPlan {
  readonly changes: PositionMapper;
  readonly structuralExtractionMode: StructuralExtractionMode;
  readonly useParagraphStructuralExtraction: boolean;
  readonly extractedDirtyWindows: readonly ExtractedDirtyStructuralWindow[];
  readonly dirtyExtractions: readonly ExtractedDirtyStructuralWindow[];
}

export interface DirtyWindowPlanningOptions {
  readonly isSyntaxTreeAvailable?: (to: number) => boolean;
}

export function createPositionMapper(
  delta: Pick<SemanticDelta, "mapOldToNew">,
): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

function mapExcludedRanges(
  values: readonly ExcludedRange[],
  changes: PositionMapper,
): readonly ExcludedRange[] {
  let changed = false;
  const mapped = values.map((value) => {
    const from = changes.mapPos(value.from, 1);
    const to = Math.max(from, changes.mapPos(value.to, -1));
    const next = from === value.from && to === value.to
      ? value
      : { from, to };
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

export function expandDirtyWindows(
  dirtyWindows: readonly DirtyWindow[],
  previousRanges: readonly { readonly from: number; readonly to: number }[],
  mapOldToNew: (pos: number, assoc?: number) => number,
  touchingInclusive: boolean,
): readonly DirtyWindow[] {
  if (previousRanges.length === 0) return dirtyWindows;

  let anyExpanded = false;
  const result = dirtyWindows.map((window) => {
    let { fromOld, toOld, fromNew, toNew } = window;
    let expanded = false;

    // Binary search to the first range whose `to` can satisfy the left-edge
    // overlap condition; the forward scan stops once source ranges are past
    // the growing dirty window.
    const minTo = touchingInclusive ? fromOld : fromOld + 1;
    let i = lowerBoundByTo(previousRanges, minTo);

    while (i < previousRanges.length) {
      const range = previousRanges[i];
      if (range.from > toOld) break;
      if (range.from <= toOld) {
        const mappedFrom = mapOldToNew(range.from, -1);
        const mappedTo = Math.max(mappedFrom, mapOldToNew(range.to, 1));
        fromOld = Math.min(fromOld, range.from);
        toOld = Math.max(toOld, range.to);
        fromNew = Math.min(fromNew, mappedFrom);
        toNew = Math.max(toNew, mappedTo);
        expanded = true;
      }
      i++;
    }

    if (expanded) anyExpanded = true;
    return expanded ? { fromOld, toOld, fromNew, toNew } : window;
  });

  return anyExpanded ? result : dirtyWindows;
}

export function mergeExcludedRanges(
  previous: readonly ExcludedRange[],
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyStructuralExtraction[],
): readonly ExcludedRange[] {
  let ranges = mapExcludedRanges(previous, createPositionMapper(delta));
  for (const { window, structural } of dirtyExtractions) {
    ranges = replaceOverlappingRanges(
      ranges,
      { from: window.fromNew, to: window.toNew },
      structural.excludedRanges,
    );
  }
  return ranges;
}

function windowTouchesRange(
  range: { readonly from: number; readonly to: number },
  window: Pick<DirtyWindow, "fromOld" | "toOld">,
): boolean {
  if (window.fromOld === window.toOld) {
    return range.from <= window.fromOld && window.fromOld <= range.to;
  }
  return range.from < window.toOld && window.fromOld < range.to;
}

function windowTouchesSortedRanges(
  window: Pick<DirtyWindow, "fromOld" | "toOld">,
  ranges: readonly { readonly from: number; readonly to: number }[],
): boolean {
  if (ranges.length === 0) {
    return false;
  }

  const index = lowerBoundByTo(
    ranges,
    window.fromOld === window.toOld ? window.fromOld : window.fromOld + 1,
  );
  for (let current = index; current < ranges.length; current += 1) {
    const range = ranges[current];
    if (range.from > window.toOld) {
      return false;
    }
    if (windowTouchesRange(range, window)) {
      return true;
    }
  }
  return false;
}

function windowsTouchSortedRanges(
  windows: readonly Pick<DirtyWindow, "fromOld" | "toOld">[],
  ranges: readonly { readonly from: number; readonly to: number }[],
): boolean {
  return windows.some((window) => windowTouchesSortedRanges(window, ranges));
}

export function classifyStructuralExtraction(
  previousState: IncrementalDocumentAnalysisState,
  delta: SemanticDelta,
): StructuralExtractionMode {
  if (!delta.plainInlineTextOnlyChange) {
    return "full";
  }

  const dirtyWindows = delta.dirtyWindows;

  const touchesStructuralOwners = (
    windowsTouchSortedRanges(dirtyWindows, previousState.headingSlice.headings)
    || windowsTouchSortedRanges(dirtyWindows, previousState.footnoteSlice.refs)
    || windowsTouchSortedRanges(dirtyWindows, previousState.footnoteSlice.definitions)
    || windowsTouchSortedRanges(dirtyWindows, previousState.fencedDivSlice.structureRanges)
    || windowsTouchSortedRanges(dirtyWindows, previousState.equationSlice.equations)
  );
  if (touchesStructuralOwners) {
    return "full";
  }

  const touchesInlineOwners = (
    windowsTouchSortedRanges(dirtyWindows, previousState.mathSlice.mathRegions)
    || windowsTouchSortedRanges(dirtyWindows, previousState.referenceSlice.references)
    || windowsTouchSortedRanges(dirtyWindows, previousState.excludedRanges)
  );
  return touchesInlineOwners ? "paragraph" : "skip";
}

function extractDirtyParagraphWindows(
  doc: TextSource,
  tree: Tree,
  dirtyWindows: readonly DirtyWindow[],
): readonly ExtractedDirtyStructuralWindow[] {
  return dirtyWindows.map((window) => {
    const range = expandRangeToParagraphBoundaries(doc, {
      from: window.fromNew,
      to: window.toNew,
    });
    return {
      window,
      range,
      structural: extractInlineStructuralWindow(doc, tree, range),
    };
  });
}

export function mapFencedDivsOnly(
  previous: readonly FencedDivSemantics[],
  changes: PositionMapper,
): readonly FencedDivSemantics[] {
  let changed = false;
  const mapped = previous.map((div) => {
    const next = mapFencedDivSemantics(div, changes);
    if (next !== div) {
      changed = true;
    }
    return next;
  });
  return changed ? mapped : previous;
}

export function planDirtyWindows(
  previousState: IncrementalDocumentAnalysisState,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  options: DirtyWindowPlanningOptions = {},
): DirtyWindowPlan {
  const changes = createPositionMapper(delta);
  const structuralExtractionMode = classifyStructuralExtraction(previousState, delta);
  const useParagraphStructuralExtraction = structuralExtractionMode === "paragraph";
  const expandedForEquations = expandDirtyWindows(
    delta.dirtyWindows,
    previousState.equationSlice.equations,
    delta.mapOldToNew,
    false,
  );
  const expandedForExcluded = expandDirtyWindows(
    expandedForEquations,
    previousState.excludedRanges,
    delta.mapOldToNew,
    true,
  );
  const availableDirtyWindows = options.isSyntaxTreeAvailable
    ? expandedForExcluded.filter((window) => options.isSyntaxTreeAvailable?.(window.toNew) ?? true)
    : expandedForExcluded;
  const extractedDirtyWindows = structuralExtractionMode === "skip"
    ? []
    : useParagraphStructuralExtraction
      ? extractDirtyParagraphWindows(doc, tree, availableDirtyWindows)
      : extractDirtyFencedDivWindows(
          previousState.fencedDivSlice.fencedDivs,
          doc,
          tree,
          changes,
          availableDirtyWindows,
        );
  const dirtyExtractions = extractedDirtyWindows.map(({ window, range, structural }) => ({
    window: {
      ...window,
      fromNew: range.from,
      toNew: range.to,
    },
    range,
    structural,
  }));

  return {
    changes,
    structuralExtractionMode,
    useParagraphStructuralExtraction,
    extractedDirtyWindows,
    dirtyExtractions,
  };
}

export function computeNarrativeExtractions(
  doc: TextSource,
  tree: Tree,
  dirtyExtractions: readonly ExtractedDirtyStructuralWindow[],
  useParagraphStructuralExtraction: boolean,
): NarrativeRefExtraction[] {
  return dirtyExtractions.map(({ window, structural }) => {
    if (useParagraphStructuralExtraction) {
      const narrativeRefs: ReferenceSemantics[] = [];
      const range = { from: window.fromNew, to: window.toNew };
      collectNarrativeRefsInWindow(
        doc,
        structural.excludedRanges,
        range,
        narrativeRefs,
      );
      return { window: range, narrativeRefs };
    }

    const { range, excludedRanges: freshExcluded } =
      computeNarrativeExtractionRange(doc, tree, window.fromNew, window.toNew);
    const narrativeRefs: ReferenceSemantics[] = [];
    collectNarrativeRefsInWindow(doc, freshExcluded, range, narrativeRefs);
    return { window: range, narrativeRefs };
  });
}
