import type { ReferenceSemantics, TextSource } from "../../document";
import { NARRATIVE_REFERENCE_RE } from "../../reference-parts";
import {
  mapRangeObject,
  replaceOverlappingRanges,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type { ExcludedRange, StructuralWindowExtraction } from "../window-extractor";

export interface ReferenceSlice {
  readonly bracketedReferences: readonly ReferenceSemantics[];
  readonly narrativeReferences: readonly ReferenceSemantics[];
  readonly references: readonly ReferenceSemantics[];
  readonly referenceByFrom: ReadonlyMap<number, ReferenceSemantics>;
}

export interface DirtyReferenceWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "bracketedRefs">;
}

/**
 * Binary search for the rightmost excluded range whose `from` <= target.
 * Returns the index, or -1 if no such range exists.
 */
function upperBoundExcluded(
  ranges: readonly ExcludedRange[],
  target: number,
): number {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid].from <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Check whether position [from, to] falls inside any excluded range,
 * using binary search on the sorted array. O(log n) per check.
 */
function isInsideExcludedRange(
  sorted: readonly ExcludedRange[],
  from: number,
  to: number,
): boolean {
  const idx = upperBoundExcluded(sorted, from);
  if (idx < 0) return false;
  return from >= sorted[idx].from && to <= sorted[idx].to;
}

/**
 * Narrative references still depend on full-document regex scanning with
 * excluded structural ranges, so this remains an explicit global fallback.
 */
export function collectNarrativeReferences(
  doc: TextSource,
  excludedRanges: readonly ExcludedRange[],
): ReferenceSemantics[] {
  const refs: ReferenceSemantics[] = [];
  const fullText = doc.slice(0, doc.length);
  const sorted = excludedRanges.slice().sort((a, b) => a.from - b.from);

  NARRATIVE_REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NARRATIVE_REFERENCE_RE.exec(fullText)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (isInsideExcludedRange(sorted, from, to)) continue;

    refs.push({
      from,
      to,
      bracketed: false,
      ids: [match[1]],
      locators: [undefined],
    });
  }

  return refs;
}

function sortReferences(
  bracketedReferences: readonly ReferenceSemantics[],
  narrativeReferences: readonly ReferenceSemantics[],
): ReferenceSemantics[] {
  const references = [...bracketedReferences, ...narrativeReferences];
  references.sort((a, b) => (a.from - b.from) || (a.to - b.to));
  return references;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameLocatorArray(
  left: readonly (string | undefined)[],
  right: readonly (string | undefined)[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameReference(
  left: ReferenceSemantics,
  right: ReferenceSemantics,
): boolean {
  return (
    left.from === right.from
    && left.to === right.to
    && left.bracketed === right.bracketed
    && sameStringArray(left.ids, right.ids)
    && sameLocatorArray(left.locators, right.locators)
  );
}

function sameReferenceArray(
  left: readonly ReferenceSemantics[],
  right: readonly ReferenceSemantics[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => sameReference(value, right[index]));
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
  doc: TextSource,
  structural: Pick<StructuralWindowExtraction, "bracketedRefs" | "excludedRanges">,
): ReferenceSlice {
  return createReferenceSlice(
    structural.bracketedRefs,
    collectNarrativeReferences(doc, structural.excludedRanges),
  );
}

export function mergeReferenceSlice(
  previous: ReferenceSlice,
  doc: TextSource,
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyReferenceWindowExtraction[],
  structural: Pick<StructuralWindowExtraction, "excludedRanges">,
): ReferenceSlice {
  let bracketedReferences = mapBracketedReferences(
    previous.bracketedReferences,
    deltaMapper(delta),
  );

  for (const { window, structural: dirtyStructural } of dirtyExtractions) {
    bracketedReferences = replaceOverlappingRanges(
      bracketedReferences,
      { from: window.fromNew, to: window.toNew },
      dirtyStructural.bracketedRefs,
    );
  }

  const nextNarrativeReferences = collectNarrativeReferences(doc, structural.excludedRanges);
  const narrativeReferences = sameReferenceArray(
    previous.narrativeReferences,
    nextNarrativeReferences,
  )
    ? previous.narrativeReferences
    : nextNarrativeReferences;

  if (
    bracketedReferences === previous.bracketedReferences
    && narrativeReferences === previous.narrativeReferences
  ) {
    return previous;
  }

  return createReferenceSlice(bracketedReferences, narrativeReferences);
}
