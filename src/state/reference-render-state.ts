/**
 * Composition module for reference renderers. Exists so that renderers
 * declare a single dependency bundle instead of reaching into the render
 * context ad hoc — keeps change-detection scoped and auditable.
 */

import type { DocumentLabelGraph } from "../app/markdown/labels";
import type { CitationRenderData } from "../lexical/render-context";
import type { RenderIndex } from "../lexical/markdown/reference-index";
import { createChangeChecker } from "./change-detection";

export interface ReferenceRenderDependencies {
  readonly renderIndex: RenderIndex;
  readonly footnoteDefinitions: ReadonlyMap<string, string>;
  readonly citations: CitationRenderData;
  readonly labelGraph: DocumentLabelGraph;
}

export function getReferenceRenderDependencies(
  context: ReferenceRenderDependencies,
): ReferenceRenderDependencies {
  return {
    renderIndex: context.renderIndex,
    footnoteDefinitions: context.footnoteDefinitions,
    citations: context.citations,
    labelGraph: context.labelGraph,
  };
}

export const referenceRenderDependenciesChanged = createChangeChecker<ReferenceRenderDependencies>(
  (deps) => deps.renderIndex,
  (deps) => deps.footnoteDefinitions,
  (deps) => deps.citations,
  (deps) => deps.labelGraph,
);

export const referenceIndexChanged = createChangeChecker<ReferenceRenderDependencies>(
  (deps) => deps.renderIndex,
);

export const citationDataChanged = createChangeChecker<ReferenceRenderDependencies>(
  (deps) => deps.citations,
);

export const footnoteDataChanged = createChangeChecker<ReferenceRenderDependencies>(
  (deps) => deps.renderIndex.footnotes,
  (deps) => deps.footnoteDefinitions,
);

export function getReferenceRenderSignature(
  deps: ReferenceRenderDependencies,
): string {
  return [
    `refs:${deps.renderIndex.references.size}`,
    `fn:${deps.renderIndex.footnotes.size}`,
    `fndef:${deps.footnoteDefinitions.size}`,
    `cited:${deps.citations.citedIds.length}`,
    `bkl:${deps.citations.backlinks.size}`,
    `labels:${deps.labelGraph.definitions.length}`,
  ].join(",");
}
