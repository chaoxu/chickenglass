import type { CslProcessor } from "../citations/csl-processor";
import type { BlockCounterEntry } from "../lib/types";
import type { DocumentSemantics } from "../semantics/document";
import type { BibStore } from "../state/bib-data";
import type { InlineReferenceRenderContext } from "./inline-render";

export interface PreviewRenderContext {
  readonly doc: string;
  readonly macros: Record<string, string>;
  readonly semantics: DocumentSemantics;
  readonly referenceSemantics: DocumentSemantics;
  readonly bibliography?: BibStore;
  readonly cslProcessor?: CslProcessor;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly referenceContext: InlineReferenceRenderContext;
}
