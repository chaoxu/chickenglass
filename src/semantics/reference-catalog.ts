import type {
  CrossrefReferenceEntry,
  LabelReferenceEntry,
} from "../references/model";
import type {
  DocumentAnalysis,
  ReferenceSemantics,
} from "./document";
import {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
} from "../references/format";

export {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
};

export type DocumentReferenceTargetKind = "block" | "equation" | "heading";

export interface BlockReferenceTargetInput {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly blockType: string;
  readonly title?: string;
  readonly displayTitle?: string;
  readonly number?: number;
}

export interface DocumentReferenceTarget {
  readonly id?: string;
  readonly kind: DocumentReferenceTargetKind;
  readonly from: number;
  readonly to: number;
  readonly displayLabel: string;
  readonly number?: string;
  readonly ordinal?: number;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
}

export interface DocumentReferenceCatalog {
  readonly targets: readonly DocumentReferenceTarget[];
  readonly targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly uniqueTargetById: ReadonlyMap<string, DocumentReferenceTarget>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly references: readonly ReferenceSemantics[];
}

export interface DocumentReferenceCatalogOptions {
  readonly blocks?: readonly BlockReferenceTargetInput[];
}

function buildDefaultBlockReferenceTargetInputs(
  analysis: DocumentAnalysis,
): BlockReferenceTargetInput[] {
  const blocks: BlockReferenceTargetInput[] = [];
  for (const div of analysis.fencedDivs) {
    if (!div.primaryClass) continue;
    blocks.push({
      from: div.from,
      to: div.to,
      id: div.id,
      blockType: div.primaryClass,
      title: div.title,
    });
  }
  return blocks;
}

function getHeadingReferenceEntry(
  analysis: DocumentAnalysis,
  id: string,
): CrossrefReferenceEntry | undefined {
  const entry = analysis.referenceIndex.get(id);
  return entry?.type === "crossref" && entry.targetKind === "heading"
    ? entry
    : undefined;
}

function getEquationReferenceEntries(
  analysis: DocumentAnalysis,
): LabelReferenceEntry[] {
  const entries: LabelReferenceEntry[] = [];
  for (const entry of analysis.referenceIndex.values()) {
    if (entry.type === "label" && entry.targetKind === "equation") {
      entries.push(entry);
    }
  }
  entries.sort((left, right) =>
    (left.target.range?.from ?? left.sourceRange.from)
      - (right.target.range?.from ?? right.sourceRange.from)
    || (left.target.range?.to ?? left.sourceRange.to)
      - (right.target.range?.to ?? right.sourceRange.to));
  return entries;
}

function buildBlockTargets(
  blocks: readonly BlockReferenceTargetInput[],
): DocumentReferenceTarget[] {
  return blocks.map((block) => ({
    id: block.id,
    kind: "block",
    from: block.from,
    to: block.to,
    displayLabel: formatBlockReferenceLabel(
      block.displayTitle ?? block.blockType,
      block.number,
    ),
    number: block.number === undefined ? undefined : String(block.number),
    ordinal: block.number,
    title: block.title,
    blockType: block.blockType,
  }));
}

function buildEquationTargets(
  analysis: DocumentAnalysis,
): DocumentReferenceTarget[] {
  return getEquationReferenceEntries(analysis)
    .flatMap((entry) => {
      const range = entry.target.range;
      if (!range) return [];
      return [{
        id: entry.id,
        kind: "equation" as const,
        from: range.from,
        to: range.to,
        displayLabel: entry.display,
        number: entry.number,
        ordinal: entry.ordinal,
        text: entry.text,
      }];
    });
}

function buildHeadingTargets(
  analysis: DocumentAnalysis,
): DocumentReferenceTarget[] {
  return analysis.headings.map((heading) => {
    const entry = heading.id ? getHeadingReferenceEntry(analysis, heading.id) : undefined;
    return {
      id: heading.id,
      kind: "heading" as const,
      from: heading.from,
      to: heading.to,
      displayLabel: entry?.display ?? formatHeadingReferenceLabel(heading),
      number: entry?.number ?? (heading.number || undefined),
      title: entry?.title ?? heading.text,
      text: entry?.text ?? heading.text,
    };
  });
}

function buildTargetsById(
  targets: readonly DocumentReferenceTarget[],
): ReadonlyMap<string, readonly DocumentReferenceTarget[]> {
  const byId = new Map<string, DocumentReferenceTarget[]>();
  for (const target of targets) {
    if (!target.id) continue;
    const bucket = byId.get(target.id);
    if (bucket) {
      bucket.push(target);
    } else {
      byId.set(target.id, [target]);
    }
  }
  return byId;
}

function buildUniqueTargetById(
  targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>,
): ReadonlyMap<string, DocumentReferenceTarget> {
  const unique = new Map<string, DocumentReferenceTarget>();
  for (const [id, targets] of targetsById) {
    if (targets.length === 1) {
      unique.set(id, targets[0]);
    }
  }
  return unique;
}

function buildDuplicatesById(
  targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>,
): ReadonlyMap<string, readonly DocumentReferenceTarget[]> {
  const duplicates = new Map<string, readonly DocumentReferenceTarget[]>();
  for (const [id, targets] of targetsById) {
    if (targets.length > 1) {
      duplicates.set(id, targets);
    }
  }
  return duplicates;
}

export function buildDocumentReferenceCatalog(
  analysis: DocumentAnalysis,
  options: DocumentReferenceCatalogOptions = {},
): DocumentReferenceCatalog {
  const targets = [
    ...buildBlockTargets(options.blocks ?? buildDefaultBlockReferenceTargetInputs(analysis)),
    ...buildEquationTargets(analysis),
    ...buildHeadingTargets(analysis),
  ];
  targets.sort((left, right) => (left.from - right.from) || (left.to - right.to));

  const targetsById = buildTargetsById(targets);
  return {
    targets,
    targetsById,
    uniqueTargetById: buildUniqueTargetById(targetsById),
    duplicatesById: buildDuplicatesById(targetsById),
    references: analysis.references,
  };
}

export function getPreferredDocumentReferenceTarget(
  catalog: DocumentReferenceCatalog,
  id: string,
): DocumentReferenceTarget | undefined {
  const targets = catalog.targetsById.get(id);
  if (!targets) return undefined;
  return targets.find((target) => target.kind === "block")
    ?? targets.find((target) => target.kind === "equation")
    ?? targets.find((target) => target.kind === "heading");
}
