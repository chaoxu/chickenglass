import type { ChangeDesc } from "@codemirror/state";
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

interface DocumentReferenceTargetIndexes {
  readonly targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly uniqueTargetById: ReadonlyMap<string, DocumentReferenceTarget>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
}

function buildReferenceTargetIndexes(
  targets: readonly DocumentReferenceTarget[],
): DocumentReferenceTargetIndexes {
  const targetsById = new Map<string, DocumentReferenceTarget[]>();
  const uniqueTargetById = new Map<string, DocumentReferenceTarget>();
  const duplicatesById = new Map<string, readonly DocumentReferenceTarget[]>();

  for (const target of targets) {
    if (!target.id) continue;
    const bucket = targetsById.get(target.id);
    if (!bucket) {
      targetsById.set(target.id, [target]);
      uniqueTargetById.set(target.id, target);
      continue;
    }

    if (bucket.length === 1) {
      uniqueTargetById.delete(target.id);
      duplicatesById.set(target.id, bucket);
    }

    bucket.push(target);
  }

  return {
    targetsById,
    uniqueTargetById,
    duplicatesById,
  };
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

  const {
    targetsById,
    uniqueTargetById,
    duplicatesById,
  } = buildReferenceTargetIndexes(targets);
  return {
    targets,
    targetsById,
    uniqueTargetById,
    duplicatesById,
    references: analysis.references,
  };
}

function mapDocumentReferenceTarget(
  target: DocumentReferenceTarget,
  changes: ChangeDesc,
): DocumentReferenceTarget {
  const from = changes.mapPos(target.from, 1);
  const to = Math.max(from, changes.mapPos(target.to, -1));
  if (from === target.from && to === target.to) {
    return target;
  }
  return {
    ...target,
    from,
    to,
  };
}

export function mapDocumentReferenceCatalog(
  catalog: DocumentReferenceCatalog,
  changes: ChangeDesc,
  references = catalog.references,
): DocumentReferenceCatalog {
  let targetsChanged = false;
  const targets: DocumentReferenceTarget[] = [];
  const targetsById = new Map<string, DocumentReferenceTarget[]>();
  const uniqueTargetById = new Map<string, DocumentReferenceTarget>();
  const duplicatesById = new Map<string, readonly DocumentReferenceTarget[]>();

  for (const target of catalog.targets) {
    const next = mapDocumentReferenceTarget(target, changes);
    if (next !== target) targetsChanged = true;
    targets.push(next);

    if (!next.id) continue;
    const bucket = targetsById.get(next.id);
    if (!bucket) {
      targetsById.set(next.id, [next]);
      uniqueTargetById.set(next.id, next);
      continue;
    }
    if (bucket.length === 1) {
      uniqueTargetById.delete(next.id);
      duplicatesById.set(next.id, bucket);
    }
    bucket.push(next);
  }

  if (!targetsChanged && references === catalog.references) {
    return catalog;
  }

  if (!targetsChanged) {
    return {
      ...catalog,
      references,
    };
  }

  return {
    targets,
    targetsById,
    uniqueTargetById,
    duplicatesById,
    references,
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
