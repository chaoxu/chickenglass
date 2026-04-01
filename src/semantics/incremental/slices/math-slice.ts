import type { Tree } from "@lezer/common";
import type { MathSemantics, TextSource } from "../../document";
import {
  mapRangeObject,
  rangesOverlap,
  replaceOverlappingRanges,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import {
  extractStructuralWindow,
  type StructuralWindowExtraction,
} from "../window-extractor";

export interface MathSlice {
  readonly mathRegions: readonly MathSemantics[];
}

export interface DirtyMathWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "mathRegions">;
}

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
  const mappedRange = mapRangeObject(value, changes);
  const contentFrom = changes.mapPos(value.contentFrom, -1);
  const contentTo = Math.max(contentFrom, changes.mapPos(value.contentTo, 1));
  const labelFrom = mapOptionalPos(value.labelFrom, changes, 1);

  if (
    mappedRange === value
    && contentFrom === value.contentFrom
    && contentTo === value.contentTo
    && labelFrom === value.labelFrom
  ) {
    return value;
  }

  return {
    ...mappedRange,
    contentFrom,
    contentTo,
    labelFrom,
  };
}

function mapMathRegions(
  values: readonly MathSemantics[],
  changes: PositionMapper,
): readonly MathSemantics[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapMathSemantics(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function deltaMapper(delta: Pick<SemanticDelta, "mapOldToNew">): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
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
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyWindows: readonly Pick<DirtyWindow, "fromNew" | "toNew">[],
): readonly { readonly from: number; readonly to: number }[] {
  const mapped = mapMathRegions(previous.mathRegions, deltaMapper(delta));
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
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyMathWindowExtraction[],
  doc: TextSource,
  tree: Tree,
): MathSlice {
  let mathRegions = mapMathRegions(previous.mathRegions, deltaMapper(delta));

  for (const { window, structural } of dirtyExtractions) {
    const overhangTo = findOverhangTo(mathRegions, window);

    mathRegions = replaceOverlappingRanges(
      mathRegions,
      { from: window.fromNew, to: window.toNew },
      structural.mathRegions,
    );

    if (overhangTo > window.toNew) {
      const overhang = extractStructuralWindow(doc, tree, {
        from: window.toNew,
        to: overhangTo,
      });
      mathRegions = replaceOverlappingRanges(
        mathRegions,
        { from: window.toNew, to: overhangTo },
        overhang.mathRegions,
      );
    }
  }

  if (mathRegions === previous.mathRegions) {
    return previous;
  }

  return { mathRegions };
}
