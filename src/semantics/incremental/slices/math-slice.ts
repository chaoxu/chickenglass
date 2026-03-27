import type { MathSemantics } from "../../document";
import {
  mapRangeObject,
  replaceOverlappingRanges,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type { StructuralWindowExtraction } from "../window-extractor";

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

export function mergeMathSlice(
  previous: MathSlice,
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyMathWindowExtraction[],
): MathSlice {
  let mathRegions = mapMathRegions(previous.mathRegions, deltaMapper(delta));

  for (const { window, structural } of dirtyExtractions) {
    mathRegions = replaceOverlappingRanges(
      mathRegions,
      { from: window.fromNew, to: window.toNew },
      structural.mathRegions,
    );
  }

  if (mathRegions === previous.mathRegions) {
    return previous;
  }

  return { mathRegions };
}
