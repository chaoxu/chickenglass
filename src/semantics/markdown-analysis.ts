import {
  type DocumentArtifacts,
  type DocumentSemantics,
} from "./document";
import { getDocumentArtifacts } from "./incremental/cached-document-analysis";

/**
 * Parse markdown with the editor's extension set and return the canonical
 * plain-data artifacts for non-CM6 consumers.
 */
export function analyzeMarkdownDocument(
  text: string,
  cacheKey?: string,
): DocumentArtifacts {
  return getDocumentArtifacts(text, cacheKey);
}

/**
 * Parse markdown with the editor's extension set and return semantic analysis.
 *
 * This is the CM6-free entry point for callers that need the same fenced-div,
 * equation, and reference semantics as the editor/indexer.
 */
export function analyzeMarkdownSemantics(
  text: string,
  cacheKey?: string,
): DocumentSemantics {
  return analyzeMarkdownDocument(text, cacheKey).analysis;
}
