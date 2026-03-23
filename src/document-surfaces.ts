import type { InlineRenderSurface } from "./inline-surface";
import { markdownToHtml, renderInline, type MarkdownToHtmlOptions } from "./app/markdown-to-html";
import { renderInlineMarkdown } from "./render/inline-render";

export type DocumentSurfaceMode = InlineRenderSurface | "document-body";

export type DocumentFragmentKind =
  | "title"
  | "block-title"
  | "footnote"
  | "hover"
  | "chrome-label";

export interface DocumentSurfaceFragment {
  kind: DocumentFragmentKind;
  text: string;
  macros?: Record<string, string>;
  surface?: DocumentSurfaceMode;
}

const DEFAULT_SURFACE_BY_KIND: Record<DocumentFragmentKind, DocumentSurfaceMode> = {
  title: "document-inline",
  "block-title": "document-inline",
  footnote: "document-body",
  hover: "document-body",
  "chrome-label": "ui-chrome-inline",
};

function resolveSurface(fragment: DocumentSurfaceFragment): DocumentSurfaceMode {
  return fragment.surface ?? DEFAULT_SURFACE_BY_KIND[fragment.kind];
}

export function renderDocumentFragmentToDom(
  container: HTMLElement,
  fragment: DocumentSurfaceFragment,
): void {
  renderInlineMarkdown(
    container,
    fragment.text,
    fragment.macros ?? {},
    resolveSurface(fragment),
  );
}

export function renderDocumentFragmentToHtml(
  fragment: DocumentSurfaceFragment,
): string {
  return renderInline(
    fragment.text,
    fragment.macros,
    resolveSurface(fragment),
  );
}

/**
 * Options for block-content rendering, extending `MarkdownToHtmlOptions`
 * minus `sectionNumbers` (irrelevant for hover preview fragments).
 */
export type BlockContentOptions = Pick<
  MarkdownToHtmlOptions,
  "macros" | "bibliography" | "cslProcessor" | "blockCounters"
>;

/**
 * Render markdown content with full block-level support into a DOM element.
 *
 * Unlike `renderDocumentFragmentToDom` (inline-only), this handles display
 * math, paragraphs, lists, blockquotes, and other block structures by using
 * the Lezer tree-walking HTML renderer from `markdown-to-html.ts`.
 *
 * Used by hover previews where block content (e.g. fenced div bodies
 * containing `$$...$$`) must render correctly.
 */
export function renderBlockContentToDom(
  container: HTMLElement,
  text: string,
  options?: BlockContentOptions,
): void {
  if (!text) return;
  container.innerHTML = markdownToHtml(text, options);
}
