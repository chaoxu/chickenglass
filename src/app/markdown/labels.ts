export type {
  DocumentLabelReference,
  DocumentLabelParseSnapshot,
  MarkdownBlock,
  MarkdownEquation,
} from "./label-parser";
export {
  buildDocumentLabelParseSnapshot,
  extractDocumentLabelReferences,
  extractMarkdownBlocks,
  extractMarkdownEquations,
} from "./label-parser";

export type {
  DocumentLabelDefinition,
  DocumentLabelGraph,
  DocumentLabelKind,
  DocumentLabelRenameValidation,
} from "./label-graph";
export {
  buildDocumentLabelGraphFromSnapshot,
  findDocumentLabelBacklinks,
  isLikelyLocalReferenceId,
  validateDocumentLabelRename,
} from "./label-graph";

export type {
  DocumentLabelBacklinkItem,
  DocumentLabelBacklinksLookup,
  DocumentLabelBacklinksResult,
  DocumentLabelRenamePlan,
  DocumentLabelRenameTarget,
  DocumentLabelRenameTargetLookup,
} from "./label-actions";
export {
  prepareDocumentLabelRename,
  resolveDocumentLabelBacklinks,
  resolveDocumentLabelRenameTarget,
} from "./label-actions";

import {
  buildDocumentLabelParseSnapshot,
  type DocumentLabelParseSnapshot,
} from "./label-parser";
import {
  buildDocumentLabelGraphFromSnapshot,
  type DocumentLabelGraph,
} from "./label-graph";

export interface DocumentScan extends DocumentLabelParseSnapshot {}

export function scanDocument(doc: string): DocumentScan {
  return buildDocumentLabelParseSnapshot(doc);
}

export function buildDocumentLabelGraph(
  doc: string,
  scan: DocumentScan = scanDocument(doc),
): DocumentLabelGraph {
  if (scan.doc !== doc) {
    return buildDocumentLabelGraphFromSnapshot(scanDocument(doc));
  }
  return buildDocumentLabelGraphFromSnapshot(scan);
}
