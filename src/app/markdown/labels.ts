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
  buildDocumentLabelGraph,
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
