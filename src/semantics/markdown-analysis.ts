import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../parser";
import {
  analyzeDocumentSemantics,
  stringTextSource,
  type DocumentSemantics,
} from "./document";

const markdownSemanticsParser = baseParser.configure(markdownExtensions);

/**
 * Parse markdown with the editor's extension set and return semantic analysis.
 *
 * This is the CM6-free entry point for callers that need the same fenced-div,
 * equation, and reference semantics as the editor/indexer.
 */
export function analyzeMarkdownSemantics(text: string): DocumentSemantics {
  const tree = markdownSemanticsParser.parse(text);
  return analyzeDocumentSemantics(stringTextSource(text), tree);
}
