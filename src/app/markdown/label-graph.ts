import type { DocumentLabelReference, DocumentLabelParseSnapshot } from "./label-parser";
import { buildDocumentLabelParseSnapshot } from "./label-parser";

const LOCAL_LABEL_RE = /^[A-Za-z0-9_](?:[\w.:-]*\w)?$/;

export type DocumentLabelKind = "block" | "equation" | "heading";

export interface DocumentLabelDefinition {
  readonly id: string;
  readonly kind: DocumentLabelKind;
  readonly from: number;
  readonly to: number;
  readonly tokenFrom: number;
  readonly tokenTo: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly displayLabel: string;
  readonly number?: string;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
  readonly content?: string;
}

export interface DocumentLabelRenameValidation {
  readonly ok: boolean;
  readonly id: string;
  readonly reason?: "empty" | "invalid-format" | "collision";
  readonly conflictingDefinitions?: readonly DocumentLabelDefinition[];
}

export interface DocumentLabelGraph {
  readonly definitions: readonly DocumentLabelDefinition[];
  readonly definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>;
  readonly uniqueDefinitionById: ReadonlyMap<string, DocumentLabelDefinition>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>;
  readonly references: readonly DocumentLabelReference[];
  readonly referencesByTarget: ReadonlyMap<string, readonly DocumentLabelReference[]>;
}

function indexDefinitionsById(
  definitions: readonly DocumentLabelDefinition[],
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const definitionsById = new Map<string, DocumentLabelDefinition[]>();
  for (const definition of definitions) {
    const group = definitionsById.get(definition.id) ?? [];
    group.push(definition);
    definitionsById.set(definition.id, group);
  }
  return definitionsById;
}

function indexUniqueDefinitions(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, DocumentLabelDefinition> {
  const uniqueDefinitions = new Map<string, DocumentLabelDefinition>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length === 1) {
      uniqueDefinitions.set(id, definitions[0]);
    }
  }
  return uniqueDefinitions;
}

function indexDuplicateDefinitions(
  definitionsById: ReadonlyMap<string, readonly DocumentLabelDefinition[]>,
): ReadonlyMap<string, readonly DocumentLabelDefinition[]> {
  const duplicates = new Map<string, readonly DocumentLabelDefinition[]>();
  for (const [id, definitions] of definitionsById) {
    if (definitions.length > 1) {
      duplicates.set(id, definitions);
    }
  }
  return duplicates;
}

function indexReferencesByTarget(
  references: readonly DocumentLabelReference[],
): ReadonlyMap<string, readonly DocumentLabelReference[]> {
  const referencesByTarget = new Map<string, DocumentLabelReference[]>();
  for (const reference of references) {
    const group = referencesByTarget.get(reference.id) ?? [];
    group.push(reference);
    referencesByTarget.set(reference.id, group);
  }
  return referencesByTarget;
}

export function buildDocumentLabelGraphFromSnapshot(
  snapshot: DocumentLabelParseSnapshot,
): DocumentLabelGraph {
  const definitions: DocumentLabelDefinition[] = [];

  for (const heading of snapshot.headings) {
    if (!heading.id || heading.labelFrom === undefined || heading.labelTo === undefined) {
      continue;
    }
    definitions.push({
      id: heading.id,
      kind: "heading",
      from: heading.from,
      to: heading.to,
      tokenFrom: heading.labelFrom - 1,
      tokenTo: heading.labelTo,
      labelFrom: heading.labelFrom,
      labelTo: heading.labelTo,
      displayLabel: heading.number || heading.id,
      number: heading.number || undefined,
      title: heading.text,
      text: heading.text,
    });
  }

  for (const block of snapshot.blocks) {
    if (!block.id || block.labelFrom === undefined || block.labelTo === undefined) {
      continue;
    }
    definitions.push({
      id: block.id,
      kind: "block",
      from: block.from,
      to: block.to,
      tokenFrom: block.labelFrom - 1,
      tokenTo: block.labelTo,
      labelFrom: block.labelFrom,
      labelTo: block.labelTo,
      displayLabel: block.id,
      title: block.title,
      text: block.content,
      blockType: block.blockType,
      content: block.content,
    });
  }

  for (const equation of snapshot.equations) {
    if (!equation.id || equation.labelFrom === undefined || equation.labelTo === undefined) {
      continue;
    }
    definitions.push({
      id: equation.id,
      kind: "equation",
      from: equation.from,
      to: equation.to,
      tokenFrom: equation.labelFrom - 1,
      tokenTo: equation.labelTo,
      labelFrom: equation.labelFrom,
      labelTo: equation.labelTo,
      displayLabel: equation.id,
      text: equation.text,
    });
  }

  const definitionsById = indexDefinitionsById(definitions);
  const uniqueDefinitionById = indexUniqueDefinitions(definitionsById);
  const duplicatesById = indexDuplicateDefinitions(definitionsById);
  const referencesByTarget = indexReferencesByTarget(snapshot.references);

  return {
    definitions,
    definitionsById,
    uniqueDefinitionById,
    duplicatesById,
    references: snapshot.references,
    referencesByTarget,
  };
}

export function buildDocumentLabelGraph(doc: string): DocumentLabelGraph {
  return buildDocumentLabelGraphFromSnapshot(buildDocumentLabelParseSnapshot(doc));
}

export function findDocumentLabelBacklinks(
  graph: DocumentLabelGraph,
  id: string,
): readonly DocumentLabelReference[] {
  return graph.referencesByTarget.get(id) ?? [];
}

export function validateDocumentLabelRename(
  graph: DocumentLabelGraph,
  nextId: string,
  options?: { currentId?: string },
): DocumentLabelRenameValidation {
  const id = nextId.trim();
  if (!id) {
    return { ok: false, id, reason: "empty" };
  }
  if (!LOCAL_LABEL_RE.test(id)) {
    return { ok: false, id, reason: "invalid-format" };
  }

  const conflictingDefinitions = graph.definitionsById.get(id) ?? [];
  const currentId = options?.currentId;
  const hasCollision = conflictingDefinitions.some((definition) => definition.id !== currentId);
  if (hasCollision) {
    return {
      ok: false,
      id,
      reason: "collision",
      conflictingDefinitions,
    };
  }

  return { ok: true, id };
}

export function isLikelyLocalReferenceId(id: string): boolean {
  return id.includes(":");
}
