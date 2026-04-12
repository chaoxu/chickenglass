/**
 * footnote-reference-renderer-registry — Renderer slot for FootnoteReferenceNode.
 *
 * The node file (`footnote-reference-node.ts`) must stay reachable from
 * `markdown.ts` without pulling in `block-renderers.tsx`, which transitively
 * imports `rich-markdown-editor` and would create a hub cycle. The registry
 * lets the node hold a typed reference to its renderer without importing it.
 *
 * `block-renderers.tsx` calls `setFootnoteReferenceRenderer(...)` at module
 * load time with the real implementation. `lexical-editor-surface.tsx` pulls
 * `block-renderers.tsx` in as a side effect so registration runs before the
 * first editor mounts.
 */
import { createElement, type ComponentType, type JSX } from "react";

export interface FootnoteReferenceRendererProps {
  readonly raw: string;
}

export type FootnoteReferenceRendererComponent = ComponentType<FootnoteReferenceRendererProps>;

function FallbackFootnoteReferenceRenderer(_props: FootnoteReferenceRendererProps): JSX.Element {
  // Rendered before block-renderers.tsx has registered. Keeps the inline
  // layout stable and visible so missing registration is noticeable without
  // crashing the editor.
  return createElement(
    "sup",
    { className: "cf-lexical-footnote-ref", "data-footnote-fallback": "true" },
    "?",
  );
}

let registered: FootnoteReferenceRendererComponent = FallbackFootnoteReferenceRenderer;

export function setFootnoteReferenceRenderer(impl: FootnoteReferenceRendererComponent): void {
  registered = impl;
}

export function getFootnoteReferenceRenderer(): FootnoteReferenceRendererComponent {
  return registered;
}
