import type { Tree } from "@lezer/common";
import { stringTextSource } from "../semantics/document-model";
import { createDocumentArtifacts } from "../semantics/incremental/engine";
import type { DocumentIR } from "./types";

/**
 * Convert a Lezer syntax tree and source text into a structured `DocumentIR`.
 *
 * This is the standalone convenience wrapper for non-CM6 callers. The shared
 * builder is also used by the incremental semantics pipeline so IR and
 * `DocumentAnalysis` stay aligned.
 */
export function treeToIR(tree: Tree, doc: string): DocumentIR {
  return createDocumentArtifacts(stringTextSource(doc), tree).ir;
}
