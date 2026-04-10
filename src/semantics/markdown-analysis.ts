import {
  analyzeDocumentArtifacts,
  type DocumentArtifacts,
  type DocumentSemantics,
  stringTextSource,
} from "./document";
import { markdownSemanticsParser } from "./markdown-parser";

/**
 * Parse markdown with the editor's extension set and return the canonical
 * plain-data artifacts for non-CM6 consumers.
 */
export function analyzeMarkdownDocument(text: string): DocumentArtifacts {
  const tree = markdownSemanticsParser.parse(text);
  return analyzeDocumentArtifacts(stringTextSource(text), tree);
}

/**
 * Parse markdown with the editor's extension set and return semantic analysis.
 *
 * This is the CM6-free entry point for callers that need the same fenced-div,
 * equation, and reference semantics as the editor/indexer.
 */
export function analyzeMarkdownSemantics(text: string): DocumentSemantics {
  return analyzeMarkdownDocument(text).analysis;
}
