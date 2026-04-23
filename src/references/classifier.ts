import type {
  EquationSemantics,
  FencedDivSemantics,
  HeadingSemantics,
  ReferenceSemantics,
  TextSource,
} from "../semantics/document-model";
import type { PositionMapper } from "../semantics/incremental/merge-utils";
import {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
} from "./format";
import type {
  CitationReferenceEntry,
  CrossrefReferenceEntry,
  LabelReferenceEntry,
  ReferenceTarget,
  ReferenceEntry,
  ReferenceIndexModel,
} from "./model";
import {
  findAttributeIdSpan,
  findBracketedOccurrenceSpan,
  findEquationLabelSpan,
  findHeadingIdSpan,
} from "./source-ranges";

const LOCAL_TARGET_PATH = "";

type LocalReferenceEntry = CrossrefReferenceEntry | LabelReferenceEntry;

export interface ReferenceIndexAnalysisInput {
  readonly headings: readonly HeadingSemantics[];
  readonly fencedDivs: readonly FencedDivSemantics[];
  readonly equations: readonly EquationSemantics[];
  readonly references: readonly ReferenceSemantics[];
}

function entryPriority(entry: LocalReferenceEntry): number {
  if (entry.targetKind === "heading") return 1;
  if (entry.targetKind === "equation") return 2;
  return 3;
}

function buildHeadingEntry(
  doc: TextSource,
  heading: HeadingSemantics,
): CrossrefReferenceEntry | undefined {
  if (!heading.id) return undefined;
  const span = findHeadingIdSpan(
    doc.slice(heading.from, heading.to),
    heading.from,
    heading.id,
  );
  if (!span) return undefined;
  return {
    id: heading.id,
    type: "crossref",
    targetKind: "heading",
    sourceRange: {
      from: span.tokenFrom,
      to: span.tokenTo,
    },
    display: formatHeadingReferenceLabel(heading),
    target: {
      path: LOCAL_TARGET_PATH,
      range: {
        from: heading.from,
        to: heading.to,
      },
    },
    number: heading.number || undefined,
    title: heading.text,
    text: heading.text,
  };
}

function buildBlockEntry(
  doc: TextSource,
  div: FencedDivSemantics,
): CrossrefReferenceEntry | undefined {
  if (
    !div.id
    || !div.primaryClass
    || div.attrFrom === undefined
    || div.attrTo === undefined
  ) {
    return undefined;
  }
  const span = findAttributeIdSpan(
    doc.slice(div.attrFrom, div.attrTo),
    div.attrFrom,
    div.id,
  );
  if (!span) return undefined;

  return {
    id: div.id,
    type: "crossref",
    targetKind: "block",
    sourceRange: {
      from: span.tokenFrom,
      to: span.tokenTo,
    },
    display: formatBlockReferenceLabel(div.primaryClass),
    target: {
      path: LOCAL_TARGET_PATH,
      range: {
        from: div.from,
        to: div.to,
      },
    },
    title: div.title,
    blockType: div.primaryClass,
  };
}

function buildEquationEntry(
  doc: TextSource,
  equation: EquationSemantics,
): LabelReferenceEntry | undefined {
  const span = findEquationLabelSpan(
    doc.slice(equation.labelFrom, equation.labelTo),
    equation.labelFrom,
    equation.id,
  );
  if (!span) return undefined;

  return {
    id: equation.id,
    type: "label",
    targetKind: "equation",
    sourceRange: {
      from: span.tokenFrom,
      to: span.tokenTo,
    },
    display: formatEquationReferenceLabel(equation.number),
    target: {
      path: LOCAL_TARGET_PATH,
      range: {
        from: equation.from,
        to: equation.to,
      },
    },
    number: String(equation.number),
    ordinal: equation.number,
    text: equation.latex,
  };
}

function buildLocalEntries(
  doc: TextSource,
  analysis: ReferenceIndexAnalysisInput,
): LocalReferenceEntry[] {
  const locals = [
    ...analysis.headings
      .map((heading) => buildHeadingEntry(doc, heading))
      .filter((entry): entry is CrossrefReferenceEntry => entry !== undefined),
    ...analysis.fencedDivs
      .map((div) => buildBlockEntry(doc, div))
      .filter((entry): entry is CrossrefReferenceEntry => entry !== undefined),
    ...analysis.equations
      .map((equation) => buildEquationEntry(doc, equation))
      .filter((entry): entry is LabelReferenceEntry => entry !== undefined),
  ];
  locals.sort((left, right) =>
    (left.target.range?.from ?? left.sourceRange.from)
      - (right.target.range?.from ?? right.sourceRange.from)
    || (left.target.range?.to ?? left.sourceRange.to)
      - (right.target.range?.to ?? right.sourceRange.to));
  return locals;
}

function setPreferredLocalEntry(
  index: Map<string, ReferenceEntry>,
  candidate: LocalReferenceEntry,
): void {
  const existing = index.get(candidate.id);
  if (
    !existing
    || existing.type === "citation"
    || entryPriority(candidate) > entryPriority(existing)
  ) {
    index.set(candidate.id, candidate);
  }
}

function createCitationEntry(
  id: string,
  from: number,
  to: number,
): CitationReferenceEntry {
  return {
    id,
    type: "citation",
    sourceRange: { from, to },
    display: id,
    target: null,
  };
}

function addCitationEntries(
  doc: TextSource,
  references: readonly ReferenceSemantics[],
  index: Map<string, ReferenceEntry>,
): void {
  for (const ref of references) {
    if (!ref.bracketed) {
      const id = ref.ids[0];
      if (!id || index.has(id)) continue;
      index.set(id, createCitationEntry(id, ref.from, ref.to));
      continue;
    }

    const raw = doc.slice(ref.from, ref.to);
    let searchFrom = 0;
    for (const id of ref.ids) {
      const span = findBracketedOccurrenceSpan(raw, ref.from, id, searchFrom);
      if (!span) continue;
      searchFrom = span.tokenTo - ref.from;
      if (index.has(id)) continue;
      index.set(id, createCitationEntry(id, span.tokenFrom, span.tokenTo));
    }
  }
}

export function classifyReferenceIndex(
  doc: TextSource,
  analysis: ReferenceIndexAnalysisInput,
): ReferenceIndexModel {
  const index = new Map<string, ReferenceEntry>();

  for (const entry of buildLocalEntries(doc, analysis)) {
    setPreferredLocalEntry(index, entry);
  }

  addCitationEntries(doc, analysis.references, index);
  return index;
}

function mapReferenceRange(
  range: ReferenceEntry["sourceRange"],
  changes: PositionMapper,
): ReferenceEntry["sourceRange"] {
  const from = changes.mapPos(range.from, 1);
  const to = Math.max(from, changes.mapPos(range.to, -1));
  if (from === range.from && to === range.to) {
    return range;
  }
  return { from, to };
}

function mapReferenceTarget(
  target: null,
  changes: PositionMapper,
): null;
function mapReferenceTarget(
  target: ReferenceTarget,
  changes: PositionMapper,
): ReferenceTarget;
function mapReferenceTarget(
  target: ReferenceEntry["target"],
  changes: PositionMapper,
): ReferenceEntry["target"] {
  if (!target?.range) {
    return target;
  }
  const range = mapReferenceRange(target.range, changes);
  if (range === target.range) {
    return target;
  }
  return {
    ...target,
    range,
  };
}

function mapReferenceEntry(
  entry: ReferenceEntry,
  changes: PositionMapper,
): ReferenceEntry {
  const sourceRange = mapReferenceRange(entry.sourceRange, changes);
  if (entry.type === "citation") {
    if (sourceRange === entry.sourceRange) {
      return entry;
    }
    return {
      ...entry,
      sourceRange,
    };
  }

  const target = mapReferenceTarget(entry.target, changes);
  if (sourceRange === entry.sourceRange && target === entry.target) {
    return entry;
  }
  return {
    ...entry,
    sourceRange,
    target,
  };
}

export function mapReferenceIndex(
  index: ReferenceIndexModel,
  changes: PositionMapper,
): ReferenceIndexModel {
  let changed = false;
  const mapped = new Map<string, ReferenceEntry>();
  for (const [id, entry] of index) {
    const next = mapReferenceEntry(entry, changes);
    if (next !== entry) {
      changed = true;
    }
    mapped.set(id, next);
  }
  return changed ? mapped : index;
}
