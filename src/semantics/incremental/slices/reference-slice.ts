import type { ReferenceSemantics } from "../../document-model";
import {
  rangesOverlap,
  type PositionMapper,
  type RangeLike,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type { StructuralWindowExtraction } from "../window-extractor";

export interface ReferenceSlice {
  readonly bracketedReferences: readonly ReferenceSemantics[];
  readonly narrativeReferences: readonly ReferenceSemantics[];
  readonly references: readonly ReferenceSemantics[];
  readonly referenceByFrom: ReadonlyMap<number, ReferenceSemantics>;
}

export interface DirtyReferenceWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "bracketedRefs" | "narrativeRefs">;
}

export interface NarrativeRefExtraction {
  readonly window: { readonly from: number; readonly to: number };
  readonly narrativeRefs: readonly ReferenceSemantics[];
}

function sortReferences(
  bracketedReferences: readonly ReferenceSemantics[],
  narrativeReferences: readonly ReferenceSemantics[],
): ReferenceSemantics[] {
  const references = [...bracketedReferences, ...narrativeReferences];
  references.sort((a, b) => (a.from - b.from) || (a.to - b.to));
  return references;
}

function deltaMapper(delta: Pick<SemanticDelta, "mapOldToNew">): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

export function mapReferenceSemantics(
  value: ReferenceSemantics,
  changes: PositionMapper,
): ReferenceSemantics {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  if (from === value.from && to === value.to) {
    return value;
  }
  return {
    from,
    to,
    bracketed: value.bracketed,
    ids: value.ids,
    locators: value.locators,
  };
}

function mapBracketedReferences(
  values: readonly ReferenceSemantics[],
  changes: PositionMapper,
): readonly ReferenceSemantics[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapReferenceSemantics(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function sameReferenceSemantics(
  left: ReferenceSemantics,
  right: ReferenceSemantics,
): boolean {
  return (
    left.from === right.from
    && left.to === right.to
    && left.bracketed === right.bracketed
    && left.ids.length === right.ids.length
    && left.ids.every((id, index) => id === right.ids[index])
    && left.locators.length === right.locators.length
    && left.locators.every((locator, index) => locator === right.locators[index])
  );
}

function replacementWindow<T extends RangeLike>(
  window: RangeLike,
  replacements: readonly T[],
): RangeLike {
  if (replacements.length === 0) return window;
  return {
    from: Math.min(window.from, replacements[0].from),
    to: Math.max(window.to, replacements[replacements.length - 1].to),
  };
}

function reuseEquivalentReferences(
  existing: readonly ReferenceSemantics[],
  replacements: readonly ReferenceSemantics[],
): readonly ReferenceSemantics[] {
  if (existing.length === 0 || replacements.length === 0) {
    return replacements;
  }

  const reused = new Set<number>();
  let changed = false;
  const normalized = replacements.map((replacement) => {
    const matchIndex = existing.findIndex((value, index) => (
      !reused.has(index) && sameReferenceSemantics(value, replacement)
    ));
    if (matchIndex === -1) {
      return replacement;
    }

    reused.add(matchIndex);
    changed = true;
    return existing[matchIndex];
  });

  return changed ? normalized : replacements;
}

function replaceReferenceRanges(
  values: readonly ReferenceSemantics[],
  window: RangeLike,
  replacements: readonly ReferenceSemantics[],
): readonly ReferenceSemantics[] {
  const targetWindow = replacementWindow(window, replacements);

  let start = values.length;
  for (let index = 0; index < values.length; index++) {
    if (
      rangesOverlap(values[index], targetWindow)
      || values[index].from >= targetWindow.from
    ) {
      start = index;
      break;
    }
  }

  if (start === values.length) {
    return replacements.length === 0 ? values : [...values, ...replacements];
  }

  let end = start;
  while (end < values.length && rangesOverlap(values[end], targetWindow)) {
    end++;
  }

  const nextReplacements = reuseEquivalentReferences(
    values.slice(start, end),
    replacements,
  );

  if (start === end && nextReplacements.length === 0) {
    return values;
  }

  if (
    end - start === nextReplacements.length
    && nextReplacements.every((value, index) => value === values[start + index])
  ) {
    return values;
  }

  return [
    ...values.slice(0, start),
    ...nextReplacements,
    ...values.slice(end),
  ];
}

export function createReferenceSlice(
  bracketedReferences: readonly ReferenceSemantics[],
  narrativeReferences: readonly ReferenceSemantics[],
): ReferenceSlice {
  const references = sortReferences(bracketedReferences, narrativeReferences);
  return {
    bracketedReferences,
    narrativeReferences,
    references,
    referenceByFrom: new Map(references.map((reference) => [reference.from, reference])),
  };
}

export function buildReferenceSlice(
  structural: Pick<StructuralWindowExtraction, "bracketedRefs" | "narrativeRefs">,
): ReferenceSlice {
  return createReferenceSlice(
    structural.bracketedRefs,
    structural.narrativeRefs,
  );
}

export function mergeReferenceSlice(
  previous: ReferenceSlice,
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyReferenceWindowExtraction[],
  narrativeExtractions?: readonly NarrativeRefExtraction[],
): ReferenceSlice {
  const mapper = deltaMapper(delta);
  let bracketedReferences = mapBracketedReferences(
    previous.bracketedReferences,
    mapper,
  );
  let narrativeReferences = mapBracketedReferences(
    previous.narrativeReferences,
    mapper,
  );

  for (const { window, structural: dirtyStructural } of dirtyExtractions) {
    const windowRange = { from: window.fromNew, to: window.toNew };
    bracketedReferences = replaceReferenceRanges(
      bracketedReferences,
      windowRange,
      dirtyStructural.bracketedRefs,
    );
  }

  if (narrativeExtractions) {
    for (const { window, narrativeRefs } of narrativeExtractions) {
      narrativeReferences = replaceReferenceRanges(
        narrativeReferences,
        window,
        narrativeRefs,
      );
    }
  } else {
    for (const { window, structural: dirtyStructural } of dirtyExtractions) {
      narrativeReferences = replaceReferenceRanges(
        narrativeReferences,
        { from: window.fromNew, to: window.toNew },
        dirtyStructural.narrativeRefs,
      );
    }
  }

  if (
    bracketedReferences === previous.bracketedReferences
    && narrativeReferences === previous.narrativeReferences
  ) {
    return previous;
  }

  return createReferenceSlice(bracketedReferences, narrativeReferences);
}
