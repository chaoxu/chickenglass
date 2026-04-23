import type { EquationSemantics } from "../../document-model";
import {
  firstOverlapIndex,
  rangesOverlap,
  replaceOverlappingRanges,
  type PositionMapper,
  type RangeLike,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type {
  EquationStructure,
  StructuralWindowExtraction,
} from "../window-extractor";

export interface EquationSlice {
  readonly equations: readonly EquationSemantics[];
  readonly equationById: ReadonlyMap<string, EquationSemantics>;
}

export interface DirtyEquationWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "equations">;
}

function buildEquationById(
  equations: readonly EquationSemantics[],
): ReadonlyMap<string, EquationSemantics> {
  return new Map(equations.map((equation) => [equation.id, equation]));
}

export function mapEquationSemantics(
  value: EquationSemantics,
  changes: PositionMapper,
): EquationSemantics {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  const labelFrom = changes.mapPos(value.labelFrom, 1);
  const labelTo = Math.max(labelFrom, changes.mapPos(value.labelTo, -1));

  if (
    from === value.from
    && to === value.to
    && labelFrom === value.labelFrom
    && labelTo === value.labelTo
  ) {
    return value;
  }

  return {
    from,
    to,
    id: value.id,
    labelFrom,
    labelTo,
    latex: value.latex,
    number: value.number,
  };
}

function mapEquations(
  values: readonly EquationSemantics[],
  changes: PositionMapper,
): readonly EquationSemantics[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapEquationSemantics(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

export function createEquationSlice(
  equations: readonly EquationSemantics[],
): EquationSlice {
  return {
    equations,
    equationById: buildEquationById(equations),
  };
}

export function buildEquationSlice(
  structural: Pick<StructuralWindowExtraction, "equations">,
): EquationSlice {
  return createEquationSlice(finalizeEquationTail(structural.equations, 0));
}

function deltaMapper(delta: Pick<SemanticDelta, "mapOldToNew">): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

function replacementStartIndex(
  equations: readonly EquationStructure[],
  window: RangeLike,
): number {
  const overlapIndex = firstOverlapIndex(equations, window);
  if (overlapIndex !== -1) return overlapIndex;
  let lo = 0;
  let hi = equations.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (equations[mid].from < window.from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function equationTouchesDirtyWindow(
  equation: EquationStructure,
  window: RangeLike,
): boolean {
  if (rangesOverlap(equation, window)) return true;
  if (window.from !== window.to) return false;
  return equation.from <= window.from && window.from <= equation.to;
}

function expandMergeWindow(
  window: RangeLike,
  replacements: readonly EquationStructure[],
): RangeLike {
  if (replacements.length === 0) return window;
  return {
    from: Math.min(window.from, replacements[0].from),
    to: Math.max(window.to, replacements[replacements.length - 1].to),
  };
}

function finalizeEquationTail(
  equations: readonly EquationStructure[],
  startIndex: number,
): readonly EquationSemantics[] {
  let nextNumber = 1;
  const prefix: EquationSemantics[] = [];
  for (let i = 0; i < startIndex; i++) {
    const eq = equations[i];
    prefix.push(finalizeEquation(eq, nextNumber++));
  }

  const tail: EquationSemantics[] = [];
  for (let i = startIndex; i < equations.length; i++) {
    const eq = equations[i];
    tail.push(finalizeEquation(eq, nextNumber++));
  }

  if (startIndex === 0) return tail;
  return [...prefix, ...tail];
}

function finalizeEquation(
  equation: EquationStructure,
  number: number,
): EquationSemantics {
  if (isFinalized(equation) && equation.number === number) return equation;
  return { ...equation, number };
}

function isFinalized(
  equation: EquationStructure,
): equation is EquationSemantics {
  return "number" in equation;
}

export function mergeEquationSlice(
  previous: EquationSlice,
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyEquationWindowExtraction[],
): EquationSlice {
  let equations: readonly EquationStructure[] = mapEquations(
    previous.equations,
    deltaMapper(delta),
  );
  let earliestAffectedIndex = Number.POSITIVE_INFINITY;

  for (const { window, structural } of dirtyExtractions) {
    const rawMergeWindow = { from: window.fromNew, to: window.toNew };
    const replacementEquations = structural.equations.filter((eq) =>
      equationTouchesDirtyWindow(eq, rawMergeWindow),
    );
    const mergeWindow = expandMergeWindow(rawMergeWindow, replacementEquations);
    const startIndex = replacementStartIndex(equations, mergeWindow);
    const nextEquations = replaceOverlappingRanges(
      equations,
      mergeWindow,
      replacementEquations,
    );

    if (nextEquations !== equations) {
      earliestAffectedIndex = Math.min(earliestAffectedIndex, startIndex);
      equations = nextEquations;
    }
  }

  if (earliestAffectedIndex === Number.POSITIVE_INFINITY) {
    if (equations === previous.equations) return previous;
    return createEquationSlice(equations as readonly EquationSemantics[]);
  }

  return createEquationSlice(finalizeEquationTail(equations, earliestAffectedIndex));
}
