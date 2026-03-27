import type {
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSemantics,
  OrderedFootnoteEntry,
} from "../../document";
import {
  mapRangeObject,
  rangesOverlap,
  type RangeLike,
  type PositionMapper,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type { StructuralWindowExtraction } from "../window-extractor";

export interface FootnoteSlice extends FootnoteSemantics {
  readonly definitions: readonly FootnoteDefinition[];
  readonly numberById: ReadonlyMap<string, number>;
  readonly orderedEntries: readonly OrderedFootnoteEntry[];
}

export interface DirtyFootnoteWindowExtraction {
  readonly window: Pick<DirtyWindow, "fromNew" | "toNew">;
  readonly structural: Pick<StructuralWindowExtraction, "footnoteRefs" | "footnoteDefs">;
}

function deltaMapper(delta: Pick<SemanticDelta, "mapOldToNew">): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

export function mapFootnoteReference(
  value: FootnoteReference,
  changes: PositionMapper,
): FootnoteReference {
  return mapRangeObject(value, changes);
}

export function mapFootnoteDefinition(
  value: FootnoteDefinition,
  changes: PositionMapper,
): FootnoteDefinition {
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

function mapFootnoteReferences(
  values: readonly FootnoteReference[],
  changes: PositionMapper,
): readonly FootnoteReference[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapFootnoteReference(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function mapFootnoteDefinitions(
  values: readonly FootnoteDefinition[],
  changes: PositionMapper,
): readonly FootnoteDefinition[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapFootnoteDefinition(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function sameFootnoteReference(
  left: FootnoteReference,
  right: FootnoteReference,
): boolean {
  return left.id === right.id && left.from === right.from && left.to === right.to;
}

function sameFootnoteDefinition(
  left: FootnoteDefinition,
  right: FootnoteDefinition,
): boolean {
  return (
    left.id === right.id
    && left.from === right.from
    && left.to === right.to
    && left.content === right.content
    && left.labelFrom === right.labelFrom
    && left.labelTo === right.labelTo
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

function reuseEquivalentReplacements<T>(
  existing: readonly T[],
  replacements: readonly T[],
  isEquivalent: (left: T, right: T) => boolean,
): readonly T[] {
  if (existing.length === 0 || replacements.length === 0) {
    return replacements;
  }

  const reused = new Set<number>();
  let changed = false;
  const normalized = replacements.map((replacement) => {
    const matchIndex = existing.findIndex((value, index) => (
      !reused.has(index) && isEquivalent(value, replacement)
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

function replaceFootnoteRanges<T extends RangeLike>(
  values: readonly T[],
  window: RangeLike,
  replacements: readonly T[],
  isEquivalent: (left: T, right: T) => boolean,
): readonly T[] {
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

  const nextReplacements = reuseEquivalentReplacements(
    values.slice(start, end),
    replacements,
    isEquivalent,
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

function findFirstReferenceChangeIndex(
  previous: readonly FootnoteReference[],
  next: readonly FootnoteReference[],
): number {
  const limit = Math.min(previous.length, next.length);
  for (let index = 0; index < limit; index++) {
    if (previous[index].id !== next[index].id) {
      return index;
    }
  }
  return previous.length === next.length ? -1 : limit;
}

function buildNumberById(
  refs: readonly FootnoteReference[],
  previous?: FootnoteSlice,
  firstRefChangeIndex: number = 0,
): ReadonlyMap<string, number> {
  if (previous && firstRefChangeIndex === -1) {
    return previous.numberById;
  }

  const numbers = new Map<string, number>();
  const seen = new Set<string>();

  if (previous && firstRefChangeIndex > 0) {
    for (let index = 0; index < firstRefChangeIndex; index++) {
      const id = refs[index].id;
      if (seen.has(id)) continue;
      seen.add(id);
      const number = previous.numberById.get(id) ?? numbers.size + 1;
      numbers.set(id, number);
    }
  }

  let nextNumber = numbers.size + 1;
  const startIndex = Math.max(0, firstRefChangeIndex);
  for (let index = startIndex; index < refs.length; index++) {
    const id = refs[index].id;
    if (seen.has(id)) continue;
    seen.add(id);
    numbers.set(id, nextNumber++);
  }

  if (
    previous
    && numbers.size === previous.numberById.size
    && Array.from(numbers.entries()).every(
      ([id, number]) => previous.numberById.get(id) === number,
    )
  ) {
    return previous.numberById;
  }

  return numbers;
}

function buildOrderedEntries(
  refs: readonly FootnoteReference[],
  defs: ReadonlyMap<string, FootnoteDefinition>,
  numberById: ReadonlyMap<string, number>,
  previous?: FootnoteSlice,
): readonly OrderedFootnoteEntry[] {
  const previousEntries = previous
    ? new Map(previous.orderedEntries.map((entry) => [entry.id, entry]))
    : null;
  const entries: OrderedFootnoteEntry[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);

    const def = defs.get(ref.id);
    if (!def) continue;

    const number = numberById.get(ref.id) ?? 0;
    const previousEntry = previousEntries?.get(ref.id);
    if (
      previousEntry
      && previousEntry.number === number
      && previousEntry.def === def
    ) {
      entries.push(previousEntry);
      continue;
    }

    entries.push({
      id: ref.id,
      number,
      def,
    });
  }

  if (
    previous
    && entries.length === previous.orderedEntries.length
    && entries.every((entry, index) => entry === previous.orderedEntries[index])
  ) {
    return previous.orderedEntries;
  }

  return entries;
}

export function createFootnoteSlice(
  refs: readonly FootnoteReference[],
  definitions: readonly FootnoteDefinition[],
  previous?: FootnoteSlice,
  firstRefChangeIndex: number = previous
    ? findFirstReferenceChangeIndex(previous.refs, refs)
    : 0,
): FootnoteSlice {
  const footnoteDefs = new Map<string, FootnoteDefinition>();
  const footnoteRefByFrom = new Map<number, FootnoteReference>();
  const footnoteDefByFrom = new Map<number, FootnoteDefinition>();

  for (const ref of refs) {
    footnoteRefByFrom.set(ref.from, ref);
  }

  for (const def of definitions) {
    footnoteDefs.set(def.id, def);
    footnoteDefByFrom.set(def.from, def);
  }

  const numberById = buildNumberById(refs, previous, firstRefChangeIndex);
  const orderedEntries = buildOrderedEntries(refs, footnoteDefs, numberById, previous);

  return {
    refs,
    definitions,
    defs: footnoteDefs,
    refByFrom: footnoteRefByFrom,
    defByFrom: footnoteDefByFrom,
    numberById,
    orderedEntries,
  };
}

export function buildFootnoteSlice(
  structural: Pick<StructuralWindowExtraction, "footnoteRefs" | "footnoteDefs">,
): FootnoteSlice {
  return createFootnoteSlice(structural.footnoteRefs, structural.footnoteDefs);
}

export function mergeFootnoteSlice(
  previous: FootnoteSlice,
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyFootnoteWindowExtraction[],
): FootnoteSlice {
  let refs = mapFootnoteReferences(previous.refs, deltaMapper(delta));
  let definitions = mapFootnoteDefinitions(previous.definitions, deltaMapper(delta));

  for (const { window, structural } of dirtyExtractions) {
    refs = replaceFootnoteRanges(
      refs,
      { from: window.fromNew, to: window.toNew },
      structural.footnoteRefs,
      sameFootnoteReference,
    );
    definitions = replaceFootnoteRanges(
      definitions,
      { from: window.fromNew, to: window.toNew },
      structural.footnoteDefs,
      sameFootnoteDefinition,
    );
  }

  if (refs === previous.refs && definitions === previous.definitions) {
    return previous;
  }

  return createFootnoteSlice(refs, definitions, previous);
}
