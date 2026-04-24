import type { DocumentLabelParseSnapshot } from "./label-parser";
import { buildDocumentLabelParseSnapshot } from "./label-parser";
import {
  createDocumentLabelGraph,
  type DocumentLabelDefinition,
  type DocumentLabelGraph,
} from "./label-model";

export type {
  DocumentLabelBacklinkTargetLookup,
  DocumentLabelDefinition,
  DocumentLabelGraph,
  DocumentLabelKind,
  DocumentLabelRenamePlan,
  DocumentLabelRenameTarget,
  DocumentLabelRenameTargetLookup,
  DocumentLabelRenameValidation,
} from "./label-model";
export {
  buildDocumentLabelRenameChanges,
  createDocumentLabelGraph,
  findDocumentLabelBacklinks,
  findDocumentLabelDefinitionAtSelection,
  findDocumentLabelReferenceAtSelection,
  getDocumentLabelDefinition,
  getDocumentLabelDefinitions,
  isValidDocumentLabelId,
  prepareDocumentLabelRenameInGraph,
  resolveDocumentLabelBacklinkTargetInGraph,
  resolveDocumentLabelRenameTargetInGraph,
  resolveDocumentLabelSelectionTargetInGraph,
  validateDocumentLabelRename,
} from "./label-model";

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

  return createDocumentLabelGraph(definitions, snapshot.references);
}

export function buildDocumentLabelGraph(doc: string): DocumentLabelGraph {
  return buildDocumentLabelGraphFromSnapshot(buildDocumentLabelParseSnapshot(doc));
}

export function isLikelyLocalReferenceId(id: string): boolean {
  return id.includes(":");
}
