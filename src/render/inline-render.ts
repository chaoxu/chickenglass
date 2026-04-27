/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Parsing and fragment building now live in `src/inline-fragments.ts`.
 * This file is intentionally only the DOM render adapter.
 */

import type { SyntaxNode } from "@lezer/common";
import type { InlineRenderSurface } from "../inline-surface";
import { CSS } from "../constants/css-classes";
import {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import { CitationWidget } from "./citation-widget";
import {
  buildInlineFragments,
  type InlineFragment,
  parseInlineFragments,
} from "../inline-fragments";
import { isSafeUrl } from "../lib/url-utils";
import {
  planReferencePresentation,
  type ReferencePresentationContext,
  type ReferencePresentationRoute,
} from "../references/presentation";
import { renderKatexToHtml } from "./inline-shared";

interface InlineSegment {
  isMath: boolean;
  content: string;
}

type DomInlineSurface = InlineRenderSurface | "document-body";

export interface InlineReferenceRenderContext extends ReferencePresentationContext {}

function renderFragments(
  container: HTMLElement | DocumentFragment,
  fragments: readonly InlineFragment[],
  macros: Record<string, string>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
): void {
  for (const fragment of fragments) {
    renderFragment(container, fragment, macros, surface, referenceContext);
  }
}

function renderReference(
  container: HTMLElement | DocumentFragment,
  fragment: Extract<InlineFragment, { kind: "reference" }>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
): void {
  if (surface === "ui-chrome-inline") {
    container.appendChild(document.createTextNode(fragment.rawText));
    return;
  }

  if (!referenceContext) {
    if (!fragment.parenthetical) {
      container.appendChild(document.createTextNode(fragment.rawText));
      return;
    }

    if (fragment.ids.length === 1) {
      const anchor = document.createElement("a");
      anchor.className = "cross-ref";
      anchor.href = `#${fragment.ids[0]}`;
      anchor.textContent = fragment.ids[0];
      if (fragment.parenthetical) {
        const span = document.createElement("span");
        span.className = CSS.citation;
        span.appendChild(anchor);
        container.appendChild(span);
      } else {
        container.appendChild(anchor);
      }
      return;
    }

    const span = document.createElement("span");
    span.className = "cf-citation";
    span.appendChild(document.createTextNode("("));
    fragment.ids.forEach((id, index) => {
      if (index > 0) span.appendChild(document.createTextNode("; "));
      const anchor = document.createElement("a");
      anchor.className = "cross-ref";
      anchor.href = `#${id}`;
      anchor.textContent = id;
      span.appendChild(anchor);
    });
    span.appendChild(document.createTextNode(")"));
    container.appendChild(span);
    return;
  }

  const raw = fragment.parenthetical
    ? `[${fragment.rawText}]`
    : fragment.rawText;
  const route = planReferencePresentation(referenceContext, {
    bracketed: fragment.parenthetical,
    ids: fragment.ids,
    locators: fragment.locators,
    raw,
  });

  if (!route) {
    container.appendChild(document.createTextNode(raw));
    return;
  }

  renderPresentationRoute(container, route);
}

function renderPresentationRoute(
  container: HTMLElement | DocumentFragment,
  route: ReferencePresentationRoute,
): void {
  switch (route.kind) {
    case "citation":
      container.appendChild(
        new CitationWidget(route.rendered, route.ids, route.narrative).createDOM(),
      );
      return;
    case "mixed-cluster":
      container.appendChild(new MixedClusterWidget(route.parts, route.raw).createDOM());
      return;
    case "crossref":
      container.appendChild(new CrossrefWidget(route.resolved, route.raw).createDOM());
      return;
    case "clustered-crossref":
      container.appendChild(new ClusteredCrossrefWidget(route.parts, route.raw).createDOM());
      return;
    case "unresolved":
      container.appendChild(new UnresolvedRefWidget(route.raw).createDOM());
      return;
  }
}

function renderFragment(
  container: HTMLElement | DocumentFragment,
  fragment: InlineFragment,
  macros: Record<string, string>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
): void {
  switch (fragment.kind) {
    case "text":
      container.appendChild(document.createTextNode(fragment.text));
      return;

    case "emphasis": {
      const em = document.createElement("em");
      em.className = CSS.italic;
      renderFragments(em, fragment.children, macros, surface, referenceContext);
      container.appendChild(em);
      return;
    }

    case "strong": {
      const strong = document.createElement("strong");
      strong.className = CSS.bold;
      renderFragments(strong, fragment.children, macros, surface, referenceContext);
      container.appendChild(strong);
      return;
    }

    case "strikethrough": {
      const del = document.createElement("del");
      del.className = CSS.strikethrough;
      renderFragments(del, fragment.children, macros, surface, referenceContext);
      container.appendChild(del);
      return;
    }

    case "highlight": {
      const highlight = document.createElement(
        surface === "document-body" ? "mark" : "span",
      );
      highlight.className = CSS.highlight;
      renderFragments(highlight, fragment.children, macros, surface, referenceContext);
      container.appendChild(highlight);
      return;
    }

    case "code": {
      const code = document.createElement("code");
      code.className = "cf-inline-code";
      code.textContent = fragment.text;
      container.appendChild(code);
      return;
    }

    case "math": {
      const span = document.createElement("span");
      span.className = CSS.mathInline;
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", fragment.latex);
      try {
        // "html" output (no .katex-mathml branch) is intentional here:
        // the rich-mode inline render path is on the typing hot path and
        // emitting MathML doubled the per-keystroke render cost on dense
        // documents (see 8121177d). Accessibility is preserved via the
        // role + aria-label above. Display math still uses the default
        // "htmlAndMathml" output (math-render.ts) so copy-as-MathML works
        // there; only inline CM6 trades the semantic branch for latency.
        span.innerHTML = renderKatexToHtml(fragment.latex, false, macros, "html");
      } catch (_e) {
        // best-effort: KaTeX render failed — show raw LaTeX source as fallback
        span.textContent = fragment.raw;
      }
      container.appendChild(span);
      return;
    }

    case "link": {
      if (surface === "ui-chrome-inline") {
        renderFragments(container, fragment.children, macros, surface, referenceContext);
        return;
      }

      const href = fragment.href?.trim();
      if (!href || !isSafeUrl(href)) {
        renderFragments(container, fragment.children, macros, surface, referenceContext);
        return;
      }

      const anchor = document.createElement("a");
      anchor.className = CSS.linkRendered;
      anchor.href = href;
      renderFragments(anchor, fragment.children, macros, surface, referenceContext);
      container.appendChild(anchor);
      return;
    }

    case "reference":
      renderReference(container, fragment, surface, referenceContext);
      return;

    case "image": {
      const src = fragment.src?.trim();
      if (surface === "document-body" && src && isSafeUrl(src)) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = fragment.rawAlt;
        container.appendChild(img);
        return;
      }
      renderFragments(container, fragment.alt, macros, surface, referenceContext);
      return;
    }

    case "footnote-ref": {
      const sup = document.createElement("sup");
      if (surface === "ui-chrome-inline") {
        sup.textContent = fragment.id;
      } else {
        const anchor = document.createElement("a");
        anchor.className = "footnote-ref";
        anchor.href = `#fn-${fragment.id}`;
        anchor.textContent = fragment.id;
        sup.appendChild(anchor);
      }
      container.appendChild(sup);
      return;
    }

    case "hard-break":
      container.appendChild(
        surface === "document-body" ? document.createElement("br") : document.createTextNode(" "),
      );
      return;
  }
}

export function splitByInlineMath(text: string): InlineSegment[] {
  const fragments = parseInlineFragments(text);
  const segments: InlineSegment[] = [];
  let currentText = "";

  const flushText = (): void => {
    if (!currentText) return;
    segments.push({ isMath: false, content: currentText });
    currentText = "";
  };

  for (const fragment of fragments) {
    if (fragment.kind === "math") {
      flushText();
      segments.push({ isMath: true, content: fragment.latex });
      continue;
    }

    if (fragment.kind === "text") {
      currentText += fragment.text;
      continue;
    }

    const scratch = document.createElement("div");
    renderFragment(scratch, fragment, {}, "document-inline");
    currentText += scratch.textContent ?? "";
  }

  flushText();
  return segments;
}

export function renderInlineMarkdown(
  container: HTMLElement,
  text: string,
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
): void {
  if (!text) return;
  renderFragments(container, parseInlineFragments(text), macros, surface, referenceContext);
}

export function renderInlineFragmentsToDom(
  container: HTMLElement | DocumentFragment,
  fragments: readonly InlineFragment[],
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
): void {
  renderFragments(container, fragments, macros, surface, referenceContext);
}

export function renderInlineSyntaxNodeToDom(
  container: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  doc: string,
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
  rangeFrom?: number,
  rangeTo?: number,
): void {
  renderInlineFragmentsToDom(
    container,
    buildInlineFragments(node, doc, rangeFrom, rangeTo),
    macros,
    surface,
    referenceContext,
  );
}
