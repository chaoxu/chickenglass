/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Parsing and fragment building now live in `src/inline-fragments.ts`.
 * This file is intentionally only the DOM render adapter.
 */

import type { ReferenceClassification } from "../index/crossref-resolver";
import type { InlineRenderSurface } from "../inline-surface";
import { CSS } from "../constants/css-classes";
import { CitationWidget } from "../citations/citation-render";
import {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import {
  type InlineFragment,
  parseInlineFragments,
} from "../inline-fragments";
import { isSafeUrl } from "../lib/url-utils";
import { renderKatexToHtml } from "./inline-shared";

interface InlineSegment {
  isMath: boolean;
  content: string;
}

type DomInlineSurface = InlineRenderSurface | "document-body";

export interface InlineReferenceRenderContext {
  classify: (
    id: string,
    preferCitation: boolean,
  ) => ReferenceClassification;
  cite: (
    ids: readonly string[],
    locators: readonly (string | undefined)[],
  ) => string;
  citeNarrative: (id: string) => string;
}

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

  if (surface === "table-preview-inline") {
    if (!referenceContext) {
      container.appendChild(document.createTextNode(fragment.rawText));
      return;
    }

    if (!fragment.parenthetical) {
      const classification = referenceContext.classify(fragment.ids[0], false);
      if (classification.kind === "crossref") {
        container.appendChild(document.createTextNode(classification.resolved.label));
        return;
      }
      if (classification.kind === "citation") {
        container.appendChild(document.createTextNode(referenceContext.citeNarrative(fragment.ids[0])));
        return;
      }
      container.appendChild(document.createTextNode(fragment.rawText));
      return;
    }

    const classifications = fragment.ids.map((id) =>
      referenceContext.classify(id, true),
    );
    const hasCitation = classifications.some((classification) => classification.kind === "citation");
    if (hasCitation) {
      container.appendChild(
        document.createTextNode(referenceContext.cite(fragment.ids, fragment.locators)),
      );
      return;
    }

    const label = classifications.map((classification, index) => (
      classification.kind === "crossref"
        ? classification.resolved.label
        : fragment.ids[index]
    )).join("; ");
    container.appendChild(document.createTextNode(`(${label})`));
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
  const classifications = fragment.ids.map((id) =>
    referenceContext.classify(id, fragment.parenthetical),
  );

  if (!fragment.parenthetical) {
    const resolved = classifications[0];
    if (resolved.kind === "crossref") {
      container.appendChild(new CrossrefWidget(resolved.resolved, raw).createDOM());
      return;
    }
    if (resolved.kind === "citation") {
      container.appendChild(
        new CitationWidget(referenceContext.citeNarrative(fragment.ids[0]), fragment.ids, true)
          .createDOM(),
      );
      return;
    }
    container.appendChild(new UnresolvedRefWidget(raw).createDOM());
    return;
  }

  const hasCitation = classifications.some((classification) => classification.kind === "citation");
  const allCitations = hasCitation
    && classifications.every((classification) => classification.kind === "citation");

  if (allCitations) {
    container.appendChild(
      new CitationWidget(referenceContext.cite(fragment.ids, fragment.locators), fragment.ids)
        .createDOM(),
    );
    return;
  }

  if (hasCitation) {
    container.appendChild(
      new MixedClusterWidget(
        fragment.ids.map((id, index) => {
          const classification = classifications[index];
          if (classification.kind === "citation") {
            return {
              kind: "citation" as const,
              id,
              text: stripOuterParens(
                referenceContext.cite(
                  [id],
                  fragment.locators[index] === undefined ? [] : [fragment.locators[index]],
                ),
              ),
            };
          }
          return {
            kind: "crossref" as const,
            id,
            text: classification.kind === "crossref" ? classification.resolved.label : id,
          };
        }),
        raw,
      ).createDOM(),
    );
    return;
  }

  if (fragment.ids.length === 1) {
    const resolved = classifications[0];
    container.appendChild(
      resolved.kind === "crossref"
        ? new CrossrefWidget(resolved.resolved, raw).createDOM()
        : new UnresolvedRefWidget(raw).createDOM(),
    );
    return;
  }

  const parts = classifications.map((classification, index) => {
    if (classification.kind === "crossref") {
      return {
        id: fragment.ids[index],
        text: classification.resolved.label,
      };
    }
    return {
      id: fragment.ids[index],
      text: fragment.ids[index],
      unresolved: true,
    };
  });

  container.appendChild(
    parts.some((part) => !part.unresolved)
      ? new ClusteredCrossrefWidget(parts, raw).createDOM()
      : new UnresolvedRefWidget(raw).createDOM(),
  );
}

function stripOuterParens(text: string): string {
  return text.startsWith("(") && text.endsWith(")")
    ? text.slice(1, -1)
    : text;
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
      const mark = document.createElement("mark");
      mark.className = CSS.highlight;
      renderFragments(mark, fragment.children, macros, surface, referenceContext);
      container.appendChild(mark);
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
      if (surface === "table-preview-inline") {
        container.appendChild(document.createTextNode(fragment.raw));
        return;
      }

      const span = document.createElement("span");
      span.className = CSS.mathInline;
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", fragment.latex);
      try {
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
