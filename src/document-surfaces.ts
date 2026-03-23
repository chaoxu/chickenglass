import type { InlineRenderSurface } from "./inline-surface";
import { renderInline } from "./app/markdown-to-html";
import { renderInlineMarkdown } from "./render";

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
