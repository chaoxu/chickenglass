/**
 * renderer-registry — single registration point for decorator-node renderers.
 *
 * Node files must stay
 * reachable from `markdown.ts` without pulling in `block-renderers.tsx`,
 * which transitively imports `rich-markdown-editor` and would close a hub
 * cycle. This registry lets each node hold a typed reference to its renderer
 * without importing the renderer module.
 *
 * Production editor entrypoints call `registerCoflatDecoratorRenderers()`
 * before mounting. Headless markdown tests do not import React renderers.
 *
 * Fallback components cover the pre-registration window (headless tests,
 * hot-reload ordering) without crashing — they render visibly so a missing
 * registration is noticeable instead of silently blank.
 */
import { type ComponentType, createElement, type JSX } from "react";

import { LEXICAL_NODE_CLASS } from "../../constants/lexical-css-classes";
import { rawBlockSourceAttrs } from "../source-position-contract";
import type { RawBlockVariant } from "./raw-block-types";

export interface FootnoteReferenceRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
}

export type FootnoteReferenceRendererComponent =
  ComponentType<FootnoteReferenceRendererProps>;

export interface HeadingAttributeRendererProps {
  readonly raw: string;
}

export type HeadingAttributeRendererComponent =
  ComponentType<HeadingAttributeRendererProps>;

export interface InlineImageRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
}

export type InlineImageRendererComponent = ComponentType<InlineImageRendererProps>;

export interface InlineMathRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
}

export type InlineMathRendererComponent = ComponentType<InlineMathRendererProps>;

export interface RawBlockRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
  readonly variant: RawBlockVariant;
}

export type RawBlockRendererComponent = ComponentType<RawBlockRendererProps>;

export interface ReferenceRendererProps {
  readonly nodeKey: string;
  readonly raw: string;
}

export type ReferenceRendererComponent = ComponentType<ReferenceRendererProps>;

function FallbackFootnoteReferenceRenderer(
  _props: FootnoteReferenceRendererProps,
): JSX.Element {
  return createElement(
    "sup",
    { className: LEXICAL_NODE_CLASS.FOOTNOTE_REFERENCE, "data-footnote-fallback": "true" },
    "?",
  );
}

function FallbackHeadingAttributeRenderer(
  _props: HeadingAttributeRendererProps,
): JSX.Element {
  return createElement("span", {
    "aria-hidden": true,
    className: "cf-heading-attribute-token__content",
  });
}

function FallbackInlineImageRenderer(props: InlineImageRendererProps): JSX.Element {
  return createElement("span", {
    className: "cf-lexical-inline-image",
    "data-inline-image-fallback": "true",
  }, props.raw);
}

function FallbackInlineMathRenderer(props: InlineMathRendererProps): JSX.Element {
  return createElement("span", {
    className: "cf-lexical-inline-math",
    "data-inline-math-fallback": "true",
  }, props.raw);
}

function FallbackRawBlockRenderer(props: RawBlockRendererProps): JSX.Element {
  return createElement("section", {
    className: `cf-lexical-raw-block-shell cf-lexical-raw-block-shell--${props.variant}`,
    ...rawBlockSourceAttrs(props.variant, true),
  });
}

function FallbackReferenceRenderer(props: ReferenceRendererProps): JSX.Element {
  return createElement("span", {
    className: "cf-lexical-reference-token",
    "data-reference-fallback": "true",
  }, props.raw);
}

interface Registered {
  readonly footnoteReference: FootnoteReferenceRendererComponent;
  readonly headingAttribute: HeadingAttributeRendererComponent;
  readonly inlineImage: InlineImageRendererComponent;
  readonly inlineMath: InlineMathRendererComponent;
  readonly rawBlock: RawBlockRendererComponent;
  readonly reference: ReferenceRendererComponent;
}

const fallback: Registered = {
  footnoteReference: FallbackFootnoteReferenceRenderer,
  headingAttribute: FallbackHeadingAttributeRenderer,
  inlineImage: FallbackInlineImageRenderer,
  inlineMath: FallbackInlineMathRenderer,
  rawBlock: FallbackRawBlockRenderer,
  reference: FallbackReferenceRenderer,
};

let registered: Registered = fallback;

export function registerRenderers(impls: Registered): void {
  registered = impls;
}

export function getFootnoteReferenceRenderer(): FootnoteReferenceRendererComponent {
  return registered.footnoteReference;
}

export function getHeadingAttributeRenderer(): HeadingAttributeRendererComponent {
  return registered.headingAttribute;
}

export function getInlineImageRenderer(): InlineImageRendererComponent {
  return registered.inlineImage;
}

export function getInlineMathRenderer(): InlineMathRendererComponent {
  return registered.inlineMath;
}

export function getRawBlockRenderer(): RawBlockRendererComponent {
  return registered.rawBlock;
}

export function getReferenceRenderer(): ReferenceRendererComponent {
  return registered.reference;
}

export function _hasRegisteredRenderersForTest(): boolean {
  return registered !== fallback;
}

export function _resetRenderersForTest(): void {
  registered = fallback;
}
