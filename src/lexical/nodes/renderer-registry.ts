/**
 * renderer-registry — single registration point for decorator-node renderers.
 *
 * Node files (`footnote-reference-node.ts`, `raw-block-node.ts`) must stay
 * reachable from `markdown.ts` without pulling in `block-renderers.tsx`,
 * which transitively imports `rich-markdown-editor` and would close a hub
 * cycle. This registry lets each node hold a typed reference to its renderer
 * without importing the renderer module.
 *
 * `block-renderers.tsx` calls `registerRenderers(...)` once at module load.
 * `lexical-editor-surface.tsx` imports `block-renderers.tsx` as a side effect
 * so registration runs before the first editor mounts.
 *
 * Fallback components cover the pre-registration window (headless tests,
 * hot-reload ordering) without crashing — they render visibly so a missing
 * registration is noticeable instead of silently blank.
 */
import { createElement, type ComponentType, type JSX } from "react";

import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import type { RawBlockVariant } from "./raw-block-types";

export interface FootnoteReferenceRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
}

export type FootnoteReferenceRendererComponent =
  ComponentType<FootnoteReferenceRendererProps>;

export interface RawBlockRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
  readonly variant: RawBlockVariant;
}

export type RawBlockRendererComponent = ComponentType<RawBlockRendererProps>;

function FallbackFootnoteReferenceRenderer(
  _props: FootnoteReferenceRendererProps,
): JSX.Element {
  return createElement(
    "sup",
    { className: LEXICAL_NODE_CLASS.FOOTNOTE_REFERENCE, "data-footnote-fallback": "true" },
    "?",
  );
}

function FallbackRawBlockRenderer(props: RawBlockRendererProps): JSX.Element {
  return createElement("section", {
    className: `cf-lexical-raw-block-shell cf-lexical-raw-block-shell--${props.variant}`,
    "data-coflat-raw-block": "true",
    "data-coflat-raw-block-variant": props.variant,
    "data-coflat-raw-block-fallback": "true",
  });
}

interface Registered {
  readonly footnoteReference: FootnoteReferenceRendererComponent;
  readonly rawBlock: RawBlockRendererComponent;
}

const fallback: Registered = {
  footnoteReference: FallbackFootnoteReferenceRenderer,
  rawBlock: FallbackRawBlockRenderer,
};

let registered: Registered = fallback;

export function registerRenderers(impls: Registered): void {
  registered = impls;
}

export function getFootnoteReferenceRenderer(): FootnoteReferenceRendererComponent {
  return registered.footnoteReference;
}

export function getRawBlockRenderer(): RawBlockRendererComponent {
  return registered.rawBlock;
}
