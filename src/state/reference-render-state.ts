/**
 * Composition module for reference renderers. Exists so that renderers
 * declare a single dependency bundle instead of reaching into the render
 * context ad hoc — keeps change-detection scoped and auditable.
 */

import type { DocumentLabelGraph } from "../app/markdown/labels";
import type { CitationRenderData } from "../lexical-next/controller/citation-runtime";
import type { RenderIndex } from "../lexical/markdown/reference-index";

export interface ReferenceRenderDependencies {
  readonly renderIndex: RenderIndex;
  readonly footnoteDefinitions: ReadonlyMap<string, string>;
  readonly citations: CitationRenderData;
  readonly labelGraph: DocumentLabelGraph;
}
