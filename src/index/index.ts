/**
 * Barrel exports for the index module.
 *
 * Includes cross-reference resolution (T12) and the background AST
 * indexer with query API (T15).
 */

// Cross-reference resolver (T12)
export type {
  CrossrefKind,
  ResolvedCrossref,
  EquationEntry,
  CrossrefMatch,
} from "./crossref-resolver";
export {
  collectEquationLabels,
  resolveCrossref,
  findCrossrefs,
} from "./crossref-resolver";

// Background indexer query API (T15)
export {
  getAllLabels,
  queryIndex,
  querySourceText,
  resolveLabel,
  findReferences,
  type IndexQuery,
  type IndexEntry,
  type IndexReference,
  type SourceTextQuery,
  type FileIndex,
  type DocumentIndex,
  type ResolvedReference,
} from "./query-api";

export {
  extractFileIndex,
  updateFileInIndex,
  removeFileFromIndex,
} from "./extract";

export { BackgroundIndexer } from "./indexer";
