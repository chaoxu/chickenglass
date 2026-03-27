import type { EquationSemantics } from "../../document";
import {
  mapRangeObject,
  type PositionMapper,
} from "../merge-utils";
import type {
  EquationStructure,
  StructuralWindowExtraction,
} from "../window-extractor";

export interface EquationSlice {
  readonly equations: readonly EquationSemantics[];
  readonly equationById: ReadonlyMap<string, EquationSemantics>;
}

function buildEquationById(
  equations: readonly EquationSemantics[],
): ReadonlyMap<string, EquationSemantics> {
  return new Map(equations.map((equation) => [equation.id, equation]));
}

function sameEquationStructure(
  left: Pick<EquationSemantics, "id" | "from" | "to" | "labelFrom" | "labelTo" | "latex">,
  right: Pick<EquationSemantics, "id" | "from" | "to" | "labelFrom" | "labelTo" | "latex">,
): boolean {
  return (
    left.id === right.id
    && left.from === right.from
    && left.to === right.to
    && left.labelFrom === right.labelFrom
    && left.labelTo === right.labelTo
    && left.latex === right.latex
  );
}

function sameEquation(
  left: EquationSemantics,
  right: EquationSemantics,
): boolean {
  return left.number === right.number && sameEquationStructure(left, right);
}

function finalizeEquations(
  equations: readonly EquationStructure[],
): EquationSemantics[] {
  let nextNumber = 1;
  return equations.map((equation) => ({
    ...equation,
    number: nextNumber++,
  }));
}

export function mapEquationSemantics(
  value: EquationSemantics,
  changes: PositionMapper,
): EquationSemantics {
  const mappedRange = mapRangeObject(value, changes);
  const labelFrom = changes.mapPos(value.labelFrom, 1);
  const labelTo = Math.max(labelFrom, changes.mapPos(value.labelTo, -1));

  if (
    mappedRange === value
    && labelFrom === value.labelFrom
    && labelTo === value.labelTo
  ) {
    return value;
  }

  return {
    ...mappedRange,
    labelFrom,
    labelTo,
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
  return createEquationSlice(finalizeEquations(structural.equations));
}

export function mergeEquationSlice(
  previous: EquationSlice,
  nextEquations: readonly EquationSemantics[],
  changes: PositionMapper,
): EquationSlice {
  // Display-math pairing can shift beyond the edited window while the user is
  // typing, so the rebuilt next slice is the correctness source of truth here.
  const mappedPrevious = mapEquations(previous.equations, changes);
  const equations = nextEquations.map((equation, index) => {
    const candidate = mappedPrevious[index];
    return candidate && sameEquation(candidate, equation) ? candidate : equation;
  });

  if (
    equations.length === previous.equations.length
    && equations.every((equation, index) => equation === previous.equations[index])
  ) {
    return previous;
  }

  return createEquationSlice(equations);
}
