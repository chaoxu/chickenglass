import type { SyntaxNode } from "@lezer/common";
import { type InlineFragment, buildInlineFragments, parseInlineFragments } from "../../inline-fragments";
import { isSafeUrl } from "../../lib/url-utils";
import { resolveProjectPathFromDocument } from "../../lib/project-paths";
import { isRelativeFilePath } from "../../lib/pdf-target";
import { CSS } from "../../constants/css-classes";
import {
  type CitationRenderContext,
  type HtmlInlineSurface,
  type InlineContext,
  type WalkContext,
  escapeHtml,
  renderMath,
} from "./shared";
import { renderCitationCluster, renderNarrativeReference } from "./references";

function isUiChromeSurface(surface: HtmlInlineSurface): boolean {
  return surface === "ui-chrome-inline";
}

export function renderInline(
  text: string,
  macros?: Record<string, string>,
  surface: HtmlInlineSurface = "document-body",
): string {
  return renderInlineWithSurface(text, { doc: text, macros, surface });
}

export function renderInlineWithSurface(
  text: string,
  options: Pick<
    InlineContext,
    | "macros"
    | "bibliography"
    | "citedIds"
    | "nextCitationOccurrence"
    | "cslProcessor"
    | "blockCounters"
    | "surface"
    | "doc"
    | "semantics"
    | "documentPath"
    | "imageUrlOverrides"
  >,
): string {
  return renderInlineFragments(parseInlineFragments(text), {
    doc: options.doc,
    macros: options.macros,
    bibliography: options.bibliography,
    citedIds: options.citedIds,
    nextCitationOccurrence: options.nextCitationOccurrence,
    cslProcessor: options.cslProcessor,
    blockCounters: options.blockCounters,
    surface: options.surface,
    semantics: options.semantics,
    documentPath: options.documentPath,
    imageUrlOverrides: options.imageUrlOverrides,
  });
}

export function renderDocumentInline(text: string, context: WalkContext): string {
  return renderInlineWithSurface(text, {
    doc: text,
    macros: context.macros,
    bibliography: context.bibliography,
    citedIds: context.citedIds,
    nextCitationOccurrence: context.nextCitationOccurrence,
    cslProcessor: context.cslProcessor,
    blockCounters: context.blockCounters,
    surface: "document-inline",
    semantics: context.semantics,
    documentPath: context.documentPath,
    imageUrlOverrides: context.imageUrlOverrides,
  });
}

export function renderChildren(
  node: SyntaxNode,
  context: InlineContext,
  rangeFrom?: number,
  rangeTo?: number,
): string {
  return renderInlineFragments(buildInlineFragments(node, context.doc, rangeFrom, rangeTo), context);
}

export function renderInlineFragments(
  fragments: readonly InlineFragment[],
  context: InlineContext,
): string {
  return fragments.map((fragment) => renderInlineFragment(fragment, context)).join("");
}

function resolveOverriddenImageSrc(
  src: string,
  context: Pick<InlineContext, "documentPath" | "imageUrlOverrides">,
): string {
  if (!context.imageUrlOverrides || context.imageUrlOverrides.size === 0) return src;
  if (!isRelativeFilePath(src)) return src;

  const resolvedPath = resolveProjectPathFromDocument(context.documentPath ?? "", src);
  return context.imageUrlOverrides.get(resolvedPath) ?? src;
}

type InlineFragmentRenderer = (fragment: InlineFragment, context: InlineContext) => string;

const inlineFragmentRenderers: {
  [K in InlineFragment["kind"]]: (
    fragment: Extract<InlineFragment, { kind: K }>,
    context: InlineContext,
  ) => string;
} = {
  text: (fragment) => escapeHtml(fragment.text),

  emphasis: (fragment, context) =>
    `<em class="${CSS.italic}">${renderInlineFragments(fragment.children, context)}</em>`,

  strong: (fragment, context) =>
    `<strong class="${CSS.bold}">${renderInlineFragments(fragment.children, context)}</strong>`,

  strikethrough: (fragment, context) =>
    `<del class="${CSS.strikethrough}">${renderInlineFragments(fragment.children, context)}</del>`,

  highlight: (fragment, context) =>
    `<mark class="${CSS.highlight}">${renderInlineFragments(fragment.children, context)}</mark>`,

  code: (fragment) => `<code class="${CSS.inlineCode}">${escapeHtml(fragment.text)}</code>`,

  math: (fragment, context) => renderMath(fragment.latex, false, context.macros),

  link: (fragment, context) => {
    const label = renderInlineFragments(fragment.children, context);
    if (isUiChromeSurface(context.surface)) return label;
    const href = fragment.href?.trim();
    if (!href) return label;
    if (isSafeUrl(href)) {
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    }
    return `<span class="unsafe-link">${label}</span>`;
  },

  reference: (fragment, context) => {
    if (isUiChromeSurface(context.surface)) {
      return escapeHtml(fragment.rawText);
    }
    const citationContext: CitationRenderContext = {
      bibliography: context.bibliography,
      citedIds: context.citedIds,
      cslProcessor: context.cslProcessor,
      blockCounters: context.blockCounters,
      semantics: context.semantics,
      nextCitationOccurrence: context.nextCitationOccurrence,
    };
    return fragment.parenthetical
      ? renderCitationCluster(fragment.ids, fragment.locators, citationContext)
      : renderNarrativeReference(fragment.ids[0], citationContext);
  },

  image: (fragment, context) => {
    const alt = renderInlineFragments(fragment.alt, context);
    if (context.surface !== "document-body") return alt;
    const src = fragment.src?.trim();
    if (!src) return alt;
    if (isSafeUrl(src)) {
      const renderedSrc = resolveOverriddenImageSrc(src, context);
      return `<img src="${escapeHtml(renderedSrc)}" alt="${escapeHtml(fragment.rawAlt)}">`;
    }
    return `<span class="unsafe-link">${alt}</span>`;
  },

  "footnote-ref": (fragment, context) => {
    const footnoteId = escapeHtml(fragment.id);
    if (isUiChromeSurface(context.surface)) {
      return `<sup>${footnoteId}</sup>`;
    }
    return `<sup><a class="footnote-ref" href="#fn-${footnoteId}">${footnoteId}</a></sup>`;
  },

  "hard-break": (_fragment, context) =>
    context.surface === "document-body" ? "<br>" : " ",
};

function renderInlineFragment(
  fragment: InlineFragment,
  context: InlineContext,
): string {
  const renderer = inlineFragmentRenderers[fragment.kind] as InlineFragmentRenderer;
  return renderer(fragment, context);
}
