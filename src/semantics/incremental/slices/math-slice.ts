import type { Tree } from "@lezer/common";
import type { MathSemantics, TextSource } from "../../document";
import {
  rangesOverlap,
  replaceOverlappingRanges,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import {
  expandRangeToParagraphBoundaries,
  extractStructuralWindow,
  type StructuralWindowExtraction,
} from "../window-extractor";

export interface MathSlice {
  readonly mathRegions: readonly MathSemantics[];
}

export interface MappedMathRegionUpdate {
  readonly all: readonly MathSemantics[];
  readonly retained: readonly MathSemantics[];
}

export interface DirtyMathWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "mathRegions">;
}

const MATH_DELIMITER_RE = /(?:\$\$|\$|\\\[|\\\]|\\\(|\\\))/;

function mapOptionalPos(
  value: number | undefined,
  changes: PositionMapper,
  assoc: number,
): number | undefined {
  return value === undefined ? undefined : changes.mapPos(value, assoc);
}

export function mapMathSemantics(
  value: MathSemantics,
  changes: PositionMapper,
): MathSemantics {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  const contentFrom = changes.mapPos(value.contentFrom, -1);
  const contentTo = Math.max(contentFrom, changes.mapPos(value.contentTo, 1));
  const labelFrom = mapOptionalPos(value.labelFrom, changes, 1);

  if (
    from === value.from
    && to === value.to
    && contentFrom === value.contentFrom
    && contentTo === value.contentTo
    && labelFrom === value.labelFrom
  ) {
    return value;
  }

  return {
    from,
    to,
    isDisplay: value.isDisplay,
    contentFrom,
    contentTo,
    labelFrom,
    latex: value.latex,
  };
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

function shiftOptionalPos(
  value: number | undefined,
  delta: number,
): number | undefined {
  return value === undefined ? undefined : value + delta;
}

function shiftMathSemantics(
  value: MathSemantics,
  delta: number,
): MathSemantics {
  return {
    from: value.from + delta,
    to: value.to + delta,
    isDisplay: value.isDisplay,
    contentFrom: value.contentFrom + delta,
    contentTo: value.contentTo + delta,
    labelFrom: shiftOptionalPos(value.labelFrom, delta),
    latex: value.latex,
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

function mathRegionTouchesRawChange(
  value: Pick<MathSemantics, "from" | "to">,
  change: Pick<DirtyWindow, "fromOld" | "toOld">,
): boolean {
  if (change.fromOld === change.toOld) {
    return value.from <= change.fromOld && change.fromOld <= value.to;
  }
  return value.from < change.toOld && change.fromOld < value.to;
}

function mathRegionTouchesRawChanges(
  value: Pick<MathSemantics, "from" | "to">,
  delta: Pick<SemanticDelta, "rawChangedRanges">,
): boolean {
  return delta.rawChangedRanges.some((change) =>
    mathRegionTouchesRawChange(value, change)
  );
}

export function mapMathRegionUpdate(
  previous: MathSlice,
  delta: Pick<SemanticDelta, "mapOldToNew" | "rawChangedRanges">,
): MappedMathRegionUpdate {
  const values = previous.mathRegions;
  if (values.length === 0 || delta.rawChangedRanges.length === 0) {
    return { all: values, retained: values };
  }

  const changes = deltaMapper(delta);
  const shiftedChange = singleChangeShift(delta);
  const firstChanged = firstChangedOldPos(delta);
  let startIndex = 0;
  while (startIndex < values.length && values[startIndex].to <= firstChanged) {
    startIndex += 1;
  }

  if (startIndex === values.length) {
    return { all: values, retained: values };
  }

  let allChanged = false;
  let retainedChanged = false;
  const allMapped = startIndex === 0 ? [] : values.slice(0, startIndex);
  const retainedMapped = startIndex === 0 ? [] : values.slice(0, startIndex);
  for (let index = startIndex; index < values.length; index += 1) {
    const value = values[index];
    const touched = mathRegionTouchesRawChanges(value, delta);
    const next = shiftedChange && value.from >= shiftedChange.toOld
      ? shiftMathSemantics(value, shiftedChange.delta)
      : mapMathSemantics(value, changes);
    if (next !== value) {
      allChanged = true;
      retainedChanged = true;
    }
    allMapped.push(next);
    if (touched) {
      retainedChanged = true;
      continue;
    }
    retainedMapped.push(next);
  }

  return {
    all: allChanged ? allMapped : values,
    retained: retainedChanged ? retainedMapped : values,
  };
}

export function createMathSlice(
  mathRegions: readonly MathSemantics[],
): MathSlice {
  return { mathRegions };
}

export function buildMathSlice(
  structural: Pick<StructuralWindowExtraction, "mathRegions">,
): MathSlice {
  return createMathSlice(structural.mathRegions);
}

function findOverhangTo(
  regions: readonly MathSemantics[],
  window: Pick<DirtyWindow, "fromNew" | "toNew">,
): number {
  let maxTo = window.toNew;
  for (const region of regions) {
    if (region.from >= window.toNew) break;
    if (rangesOverlap(region, { from: window.fromNew, to: window.toNew })) {
      if (region.to > maxTo) maxTo = region.to;
    }
  }
  return maxTo;
}

function rangesTouchOrOverlap(
  region: Pick<MathSemantics, "from" | "to">,
  window: Pick<DirtyWindow, "fromNew" | "toNew">,
): boolean {
  return region.from <= window.toNew && window.fromNew <= region.to;
}

function touchesMathRegion(
  regions: readonly MathSemantics[],
  window: Pick<DirtyWindow, "fromNew" | "toNew">,
): boolean {
  return regions.some((region) => rangesTouchOrOverlap(region, window));
}

function windowTouchesMathDelimiter(
  doc: TextSource,
  window: Pick<DirtyWindow, "fromNew" | "toNew">,
): boolean {
  const from = Math.max(0, window.fromNew - 1);
  const to = Math.min(doc.length, window.toNew + 1);
  return MATH_DELIMITER_RE.test(doc.slice(from, to));
}

function shouldExpandMathWindowToParagraph(
  mappedPrevious: readonly MathSemantics[],
  extraction: DirtyMathWindowExtraction,
  doc: TextSource,
): boolean {
  return (
    windowTouchesMathDelimiter(doc, extraction.window)
    || touchesMathRegion(mappedPrevious, extraction.window)
    || touchesMathRegion(extraction.structural.mathRegions, extraction.window)
  );
}

export function expandDirtyMathExtractions(
  previous: MathSlice,
  delta: Pick<SemanticDelta, "mapOldToNew" | "rawChangedRanges">,
  dirtyExtractions: readonly DirtyMathWindowExtraction[],
  doc: TextSource,
  tree: Tree,
  mappedRegions: MappedMathRegionUpdate = mapMathRegionUpdate(previous, delta),
): readonly DirtyMathWindowExtraction[] {
  const mappedPrevious = mappedRegions.all;
  let changed = false;

  const expanded = dirtyExtractions.map((extraction) => {
    if (!shouldExpandMathWindowToParagraph(mappedPrevious, extraction, doc)) {
      return extraction;
    }

    const range = expandRangeToParagraphBoundaries(doc, {
      from: extraction.window.fromNew,
      to: extraction.window.toNew,
    });
    if (
      range.from === extraction.window.fromNew
      && range.to === extraction.window.toNew
    ) {
      return extraction;
    }

    changed = true;
      return {
        window: { fromNew: range.from, toNew: range.to },
        structural: extractStructuralWindow(doc, tree, range, {
          includeNarrativeRefs: false,
        }),
      };
  });

  return changed ? expanded : dirtyExtractions;
}

/**
 * Detect overhang ranges where mapped math regions extend past dirty windows.
 *
 * When a large mapped region (e.g. BigUnclosed $$…EOF) overlaps a dirty window
 * and is removed by replaceOverlappingRanges, its tail beyond the window is
 * lost.  mergeMathSlice handles re-extraction for mathRegions internally, but
 * other slices (equations) need the overhang ranges so the engine can add extra
 * dirty extractions for them.
 */
export function computeMathOverhangRanges(
  previous: MathSlice,
  delta: Pick<SemanticDelta, "mapOldToNew" | "rawChangedRanges">,
  dirtyWindows: readonly Pick<DirtyWindow, "fromNew" | "toNew">[],
  mappedRegions: MappedMathRegionUpdate = mapMathRegionUpdate(previous, delta),
): readonly { readonly from: number; readonly to: number }[] {
  const mapped = mappedRegions.all;
  const overhangs: { from: number; to: number }[] = [];
  for (const window of dirtyWindows) {
    const overhangTo = findOverhangTo(mapped, window);
    if (overhangTo > window.toNew) {
      overhangs.push({ from: window.toNew, to: overhangTo });
    }
  }
  return overhangs;
}

export function mergeMathSlice(
  previous: MathSlice,
  delta: Pick<SemanticDelta, "mapOldToNew" | "rawChangedRanges">,
  dirtyExtractions: readonly DirtyMathWindowExtraction[],
  doc: TextSource,
  tree: Tree,
  mappedRegions: MappedMathRegionUpdate = mapMathRegionUpdate(previous, delta),
): MathSlice {
  let mathRegions = mappedRegions.retained;

  for (const { window, structural } of dirtyExtractions) {
    const overhangTo = findOverhangTo(mathRegions, window);

    // extractStructuralWindow uses inclusive boundary checks (c.from <=
    // range.to && c.to >= range.from), so it can return regions that merely
    // touch the window boundary without strictly overlapping it.
    // replaceOverlappingRanges uses strict overlap (value.from < window.to &&
    // window.from < value.to), so boundary-touching regions are NOT removed
    // from the existing mathRegions array before the replacements are spliced
    // in, causing duplicates.  Filter both the structural and overhang
    // replacement lists to only include regions that strictly overlap their
    // respective replacement windows.
    const strictStructural = structural.mathRegions.filter(
      (r) => r.from < window.toNew && r.to > window.fromNew,
    );
    mathRegions = replaceOverlappingRanges(
      mathRegions,
      { from: window.fromNew, to: window.toNew },
      strictStructural,
    );

    if (overhangTo > window.toNew) {
      const overhang = extractStructuralWindow(doc, tree, {
        from: window.toNew,
        to: overhangTo,
      }, {
        includeNarrativeRefs: false,
      });
      const overhangRegions = overhang.mathRegions.filter(
        (r) => r.from < overhangTo && r.to > window.toNew,
      );
      mathRegions = replaceOverlappingRanges(
        mathRegions,
        { from: window.toNew, to: overhangTo },
        overhangRegions,
      );
    }
  }

  if (mathRegions === previous.mathRegions) {
    return previous;
  }

  return { mathRegions };
}
