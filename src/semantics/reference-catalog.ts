import type {
  DocumentAnalysis,
  HeadingSemantics,
  ReferenceSemantics,
} from "./document";

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

export function formatBlockReferenceLabel(
  displayTitle: string,
  number?: number,
): string {
  return number === undefined ? displayTitle : `${displayTitle} ${number}`;
}

export function formatEquationReferenceLabel(number: number | string): string {
  return `Eq. (${number})`;
}

export function formatHeadingReferenceLabel(
  heading: Pick<HeadingSemantics, "number" | "text">,
): string {
  return heading.number ? `Section ${heading.number}` : heading.text;
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
  return analysis.equations.map((equation) => ({
    id: equation.id,
    kind: "equation",
    from: equation.from,
    to: equation.to,
    displayLabel: formatEquationReferenceLabel(equation.number),
    number: String(equation.number),
    ordinal: equation.number,
    text: equation.latex,
  }));
}

function buildHeadingTargets(
  analysis: DocumentAnalysis,
): DocumentReferenceTarget[] {
  return analysis.headings.map((heading) => ({
    id: heading.id,
    kind: "heading",
    from: heading.from,
    to: heading.to,
    displayLabel: formatHeadingReferenceLabel(heading),
    number: heading.number || undefined,
    title: heading.text,
    text: heading.text,
  }));
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
