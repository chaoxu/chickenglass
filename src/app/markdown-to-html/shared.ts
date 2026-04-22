import { parser as baseParser } from "@lezer/markdown";
import type { InlineRenderSurface } from "../../inline-surface";
import { htmlRenderExtensions } from "../../parser";
import { renderKatexToHtml } from "../../render/inline-shared";
import type { BibStore } from "../../state/bib-data";
import type { CitationBacklink, CslProcessor } from "../../citations/csl-processor";
import type { DocumentSemantics } from "../../semantics/document";
import type { BlockCounterEntry } from "../../lib/types";

export type { BlockCounterEntry };

export const mdParser = baseParser.configure(htmlRenderExtensions);

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMath(
  latex: string,
  displayMode: boolean,
  macros?: Record<string, string>,
): string {
  try {
    return renderKatexToHtml(latex, displayMode, macros ?? {});
  } catch (_error) {
    const escaped = escapeHtml(latex);
    return displayMode
      ? `<pre class="math-error">${escaped}</pre>`
      : `<code class="math-error">${escaped}</code>`;
  }
}

export interface MarkdownToHtmlOptions {
  macros?: Record<string, string>;
  sectionNumbers?: boolean;
  bibliography?: BibStore;
  cslProcessor?: CslProcessor;
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  includeBibliography?: boolean;
  documentPath?: string;
  imageUrlOverrides?: ReadonlyMap<string, string>;
}

export type HtmlInlineSurface = InlineRenderSurface | "document-body";

export interface InlineContext {
  readonly doc: string;
  macros?: Record<string, string>;
  bibliography?: BibStore;
  citedIds?: string[];
  nextCitationOccurrence?: { value: number };
  cslProcessor?: CslProcessor;
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  surface: HtmlInlineSurface;
  semantics?: DocumentSemantics;
  documentPath?: string;
  imageUrlOverrides?: ReadonlyMap<string, string>;
}

export interface WalkContext {
  readonly doc: string;
  readonly macros?: Record<string, string>;
  readonly sectionNumbers: boolean;
  readonly semantics: DocumentSemantics;
  readonly bibliography?: BibStore;
  readonly cslProcessor?: CslProcessor;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly surface: "document-body";
  readonly citedIds: string[];
  readonly citationBacklinks: ReadonlyMap<string, readonly CitationBacklink[]>;
  readonly nextCitationOccurrence: { value: number };
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
}

export function documentBodyInlineContext(
  doc: string,
  context: Pick<
    WalkContext,
    | "macros"
    | "bibliography"
    | "citedIds"
    | "nextCitationOccurrence"
    | "cslProcessor"
    | "blockCounters"
    | "semantics"
    | "documentPath"
    | "imageUrlOverrides"
  >,
): Pick<
  InlineContext,
  | "doc"
  | "macros"
  | "bibliography"
  | "citedIds"
  | "nextCitationOccurrence"
  | "cslProcessor"
  | "blockCounters"
  | "surface"
  | "semantics"
  | "documentPath"
  | "imageUrlOverrides"
> {
  return {
    doc,
    macros: context.macros,
    bibliography: context.bibliography,
    citedIds: context.citedIds,
    nextCitationOccurrence: context.nextCitationOccurrence,
    cslProcessor: context.cslProcessor,
    blockCounters: context.blockCounters,
    surface: "document-body",
    semantics: context.semantics,
    documentPath: context.documentPath,
    imageUrlOverrides: context.imageUrlOverrides,
  };
}

export interface CitationRenderContext {
  bibliography?: BibStore;
  citedIds?: string[];
  cslProcessor?: CslProcessor;
  blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  semantics?: DocumentSemantics;
  nextCitationOccurrence?: { value: number };
}
