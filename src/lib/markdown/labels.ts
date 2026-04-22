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

// Single-entry cache keyed by `doc` identity — addresses #173 (rename
// dialog invoking this fresh) and any other non-render call site that
// happens to pass the same doc repeatedly.
let cachedGraphDoc: string | null = null;
let cachedGraph: DocumentLabelGraph | null = null;

export function buildDocumentLabelGraph(
  doc: string,
  scan?: DocumentScan,
): DocumentLabelGraph {
  if (scan === undefined && cachedGraph && cachedGraphDoc === doc) {
    return cachedGraph;
  }
  const resolvedScan = scan && scan.doc === doc ? scan : scanDocument(doc);
  const graph = buildDocumentLabelGraphFromSnapshot(resolvedScan);
  if (scan === undefined) {
    cachedGraphDoc = doc;
    cachedGraph = graph;
  }
  return graph;
}
