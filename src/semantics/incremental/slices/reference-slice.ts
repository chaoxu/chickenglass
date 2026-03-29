import type { ReferenceSemantics } from "../../document";
import {
  mapRangeObject,
  replaceOverlappingRanges,
  type PositionMapper,
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
  return mapRangeObject(value, changes);
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
    bracketedReferences = replaceOverlappingRanges(
      bracketedReferences,
      windowRange,
      dirtyStructural.bracketedRefs,
    );
  }

  if (narrativeExtractions) {
    for (const { window, narrativeRefs } of narrativeExtractions) {
      narrativeReferences = replaceOverlappingRanges(
        narrativeReferences,
        window,
        narrativeRefs,
      );
    }
  } else {
    for (const { window, structural: dirtyStructural } of dirtyExtractions) {
      narrativeReferences = replaceOverlappingRanges(
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
