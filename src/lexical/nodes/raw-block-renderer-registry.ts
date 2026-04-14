/**
 * raw-block-renderer-registry — Renderer slot for RawBlockNode.
 *
 * Keeps `raw-block-node.ts` free of `block-renderers.tsx` so node files no
 * longer close the rich-markdown-editor ↔ block-renderers cycle hub. See
 * `footnote-reference-renderer-registry.ts` for the parallel case.
 */
import { createElement, type ComponentType, type JSX } from "react";

import type { RawBlockVariant } from "./raw-block-types";

export type RawBlockRendererVariant = RawBlockVariant;

export interface RawBlockRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
  readonly variant: RawBlockRendererVariant;
}

export type RawBlockRendererComponent = ComponentType<RawBlockRendererProps>;

function FallbackRawBlockRenderer(props: RawBlockRendererProps): JSX.Element {
  // Rendered before block-renderers.tsx has registered. Keeps the block shell
  // and variant data-attr so the surrounding CSS/layout still applies.
  return createElement(
    "section",
    {
      className: `cf-lexical-raw-block-shell cf-lexical-raw-block-shell--${props.variant}`,
      "data-coflat-raw-block": "true",
      "data-coflat-raw-block-variant": props.variant,
      "data-coflat-raw-block-fallback": "true",
    },
  );
}

let registered: RawBlockRendererComponent = FallbackRawBlockRenderer;

export function setRawBlockRenderer(impl: RawBlockRendererComponent): void {
  registered = impl;
}

export function getRawBlockRenderer(): RawBlockRendererComponent {
  return registered;
}
