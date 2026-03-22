/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Handles:
 * - Inline math ($...$ and \(...\)) via KaTeX
 * - Bold (**text**)
 * - Italic (*text*)
 * - Strikethrough (~~text~~)
 * - Highlight (==text==)
 * - Inline code (`code`)
 * - Escape sequences (\* etc.)
 * - Hard breaks
 *
 * Uses Lezer tree-walking for correct parsing of nested inline formatting.
 *
 * Used by block header widgets, sidenote margin, and footnote section
 * to avoid duplicating the same parsing/rendering logic.
 */

import katex from "katex";
import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { markdownExtensions } from "../parser";
import type { InlineRenderSurface } from "../inline-surface";
import { stripMathDelimiters } from "./math-render";

/** Standalone Lezer parser for splitting inline math without a CM6 editor context. */
const inlineParser = baseParser.configure(markdownExtensions);

/** A segment of text split by inline math delimiters. */
interface InlineSegment {
  isMath: boolean;
  content: string;
}

/**
 * Split text by inline math delimiters using Lezer, returning alternating
 * text/math segments. Math content has delimiters stripped (ready for KaTeX).
 */
export function splitByInlineMath(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const tree = inlineParser.parse(text);
  let lastIndex = 0;

  tree.iterate({
    enter(node) {
      if (node.type.name !== "InlineMath") return;
      if (node.from > lastIndex) {
        segments.push({ isMath: false, content: text.slice(lastIndex, node.from) });
      }
      const raw = text.slice(node.from, node.to);
      segments.push({ isMath: true, content: stripMathDelimiters(raw, false) });
      lastIndex = node.to;
      return false; // skip InlineMathMark children
    },
  });

  if (lastIndex < text.length) {
    segments.push({ isMath: false, content: text.slice(lastIndex) });
  }

  return segments;
}

// ── Lezer tree-walking inline renderer ──────────────────────────────────────

/** Set of node names that are "marks" (delimiters) to skip. */
const MARK_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
  "HighlightMark",
  "InlineMathMark",
]);

type DomInlineSurface = InlineRenderSurface | "document-body";

function isUiChromeSurface(surface: DomInlineSurface): boolean {
  return surface === "ui-chrome-inline";
}

function isSafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return !(
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  );
}

/**
 * Render the inline children of a node (e.g., Paragraph, Emphasis) as DOM
 * nodes, appending them to the given container.
 *
 * Walks the node's children, rendering inline elements and collecting
 * plain text gaps between them as text nodes.
 */
function renderChildren(
  node: SyntaxNode,
  text: string,
  macros: Record<string, string>,
  surface: DomInlineSurface,
  container: HTMLElement | DocumentFragment,
): void {
  let pos = node.from;
  let child = node.firstChild;

  while (child) {
    // Text gap between previous position and this child
    if (child.from > pos) {
      container.appendChild(document.createTextNode(text.slice(pos, child.from)));
    }

    renderInlineNode(child, text, macros, surface, container);
    pos = child.to;
    child = child.nextSibling;
  }

  // Trailing text after last child
  if (pos < node.to) {
    container.appendChild(document.createTextNode(text.slice(pos, node.to)));
  }
}

/**
 * Render a single inline node as a DOM element (or skip it for marks).
 * Appends the result to the container.
 */
function renderInlineNode(
  node: SyntaxNode,
  text: string,
  macros: Record<string, string>,
  surface: DomInlineSurface,
  container: HTMLElement | DocumentFragment,
): void {
  // Skip delimiter marks
  if (MARK_NODES.has(node.name)) {
    return;
  }

  switch (node.name) {
    case "Emphasis": {
      const em = document.createElement("em");
      renderChildren(node, text, macros, surface, em);
      container.appendChild(em);
      return;
    }

    case "StrongEmphasis": {
      const strong = document.createElement("strong");
      renderChildren(node, text, macros, surface, strong);
      container.appendChild(strong);
      return;
    }

    case "Strikethrough": {
      const del = document.createElement("del");
      renderChildren(node, text, macros, surface, del);
      container.appendChild(del);
      return;
    }

    case "Highlight": {
      const mark = document.createElement("mark");
      renderChildren(node, text, macros, surface, mark);
      container.appendChild(mark);
      return;
    }

    case "InlineCode": {
      const code = document.createElement("code");
      const marks = node.getChildren("CodeMark");
      if (marks.length >= 2) {
        code.textContent = text.slice(marks[0].to, marks[marks.length - 1].from);
      } else {
        code.textContent = text.slice(node.from, node.to);
      }
      container.appendChild(code);
      return;
    }

    case "Link": {
      renderLink(node, text, macros, surface, container);
      return;
    }

    case "Image": {
      renderImage(node, text, surface, container);
      return;
    }

    case "InlineMath": {
      const span = document.createElement("span");
      const raw = text.slice(node.from, node.to);
      const latex = stripMathDelimiters(raw, false);
      try {
        span.innerHTML = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false,
          macros,
        });
      } catch {
        // KaTeX render failed — show raw LaTeX source as fallback
        span.textContent = raw;
      }
      container.appendChild(span);
      return;
    }

    case "FootnoteRef": {
      renderFootnoteRef(node, text, surface, container);
      return;
    }

    case "Escape": {
      // \$ → $, \* → *, etc. — strip the backslash
      container.appendChild(document.createTextNode(text.slice(node.from + 1, node.to)));
      return;
    }

    case "HardBreak": {
      if (surface === "document-body") {
        container.appendChild(document.createElement("br"));
      } else {
        container.appendChild(document.createTextNode(" "));
      }
      return;
    }

    case "URL": {
      return;
    }

    default: {
      // Unknown inline node — render its text
      container.appendChild(document.createTextNode(text.slice(node.from, node.to)));
      return;
    }
  }
}

function getDelimitedText(
  node: SyntaxNode,
  text: string,
  fallbackFrom: number = node.from,
  fallbackTo: number = node.to,
): string {
  const marks = node.getChildren("LinkMark");
  if (marks.length >= 2) {
    return text.slice(marks[0].to, marks[1].from);
  }
  return text.slice(fallbackFrom, fallbackTo);
}

function renderLinkText(
  node: SyntaxNode,
  text: string,
  macros: Record<string, string>,
  surface: DomInlineSurface,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2) {
    fragment.appendChild(document.createTextNode(text.slice(node.from, node.to)));
    return fragment;
  }

  const textFrom = marks[0].to;
  const textTo = marks[1].from;
  let pos = textFrom;
  let child = node.firstChild;

  while (child) {
    if (child.to > textFrom && child.from < textTo) {
      if (child.from > pos) {
        fragment.appendChild(document.createTextNode(text.slice(pos, child.from)));
      }
      renderInlineNode(child, text, macros, surface, fragment);
      pos = child.to;
    }
    child = child.nextSibling;
  }

  if (pos < textTo) {
    fragment.appendChild(document.createTextNode(text.slice(pos, textTo)));
  }

  return fragment;
}

function renderCrossReferences(
  rawLinkText: string,
  surface: DomInlineSurface,
  container: HTMLElement | DocumentFragment,
): void {
  if (surface === "document-body" || surface === "document-inline") {
    const ids = rawLinkText.split(";").map((part) => part.trim().replace(/^@/, ""));
    if (ids.length === 1) {
      const anchor = document.createElement("a");
      anchor.className = "cross-ref";
      anchor.href = `#${ids[0]}`;
      anchor.textContent = ids[0];
      container.appendChild(anchor);
      return;
    }

    const span = document.createElement("span");
    span.className = "cf-citation";
    span.appendChild(document.createTextNode("("));
    ids.forEach((id, index) => {
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

  container.appendChild(document.createTextNode(rawLinkText));
}

function renderLink(
  node: SyntaxNode,
  text: string,
  macros: Record<string, string>,
  surface: DomInlineSurface,
  container: HTMLElement | DocumentFragment,
): void {
  const raw = text.slice(node.from, node.to);
  const crossRefMatch = /^\[@([^\]]+)\]$/.exec(raw);
  if (crossRefMatch) {
    const fragment = renderLinkText(node, text, macros, surface);
    renderCrossReferences(fragment.textContent ?? crossRefMatch[1], surface, container);
    return;
  }

  const linkText = renderLinkText(node, text, macros, surface);
  if (isUiChromeSurface(surface)) {
    container.appendChild(linkText);
    return;
  }

  const urlNode = node.getChild("URL");
  if (!urlNode) {
    container.appendChild(linkText);
    return;
  }

  const href = text.slice(urlNode.from, urlNode.to).trim();
  if (!isSafeUrl(href)) {
    container.appendChild(linkText);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.appendChild(linkText);
  container.appendChild(anchor);
}

function renderImage(
  node: SyntaxNode,
  text: string,
  surface: DomInlineSurface,
  container: HTMLElement | DocumentFragment,
): void {
  const alt = getDelimitedText(node, text);
  if (surface === "document-body") {
    const urlNode = node.getChild("URL");
    if (urlNode) {
      const src = text.slice(urlNode.from, urlNode.to).trim();
      if (!isSafeUrl(src)) {
        if (alt) {
          container.appendChild(document.createTextNode(alt));
        }
        return;
      }
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt;
      container.appendChild(img);
      return;
    }
  }

  if (alt) {
    container.appendChild(document.createTextNode(alt));
  }
}

function renderFootnoteRef(
  node: SyntaxNode,
  text: string,
  surface: DomInlineSurface,
  container: HTMLElement | DocumentFragment,
): void {
  const raw = text.slice(node.from, node.to);
  const match = /^\[\^([^\]]+)\]$/.exec(raw);
  if (!match) {
    container.appendChild(document.createTextNode(raw));
    return;
  }

  const sup = document.createElement("sup");
  if (isUiChromeSurface(surface)) {
    sup.textContent = match[1];
  } else {
    const anchor = document.createElement("a");
    anchor.className = "footnote-ref";
    anchor.href = `#fn-${match[1]}`;
    anchor.textContent = match[1];
    sup.appendChild(anchor);
  }
  container.appendChild(sup);
}

/**
 * Render inline markdown (math + bold + italic + strikethrough + highlight +
 * inline code + escapes + hard breaks) into a DOM container.
 *
 * This is the single entry point for all inline content rendering in
 * widgets, sidenote panels, and footnote sections.
 *
 * Parses the text with Lezer and walks the syntax tree to produce DOM nodes,
 * giving correct handling of nested inline formatting.
 *
 * @param container - The DOM element to append rendered content to.
 * @param text - Markdown text with inline formatting.
 * @param macros - KaTeX macro definitions from frontmatter.
 */
export function renderInlineMarkdown(
  container: HTMLElement,
  text: string,
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
): void {
  if (!text) return;

  const tree = inlineParser.parse(text);
  const doc = tree.topNode;
  // Lezer wraps the text in Document > Paragraph
  const para = doc.firstChild;
  if (!para) {
    container.appendChild(document.createTextNode(text));
    return;
  }

  // Text before paragraph (e.g., leading whitespace not included by Lezer)
  if (para.from > 0) {
    container.appendChild(document.createTextNode(text.slice(0, para.from)));
  }

  renderChildren(para, text, macros, surface, container);

  // Text after paragraph (e.g., trailing content not included by Lezer)
  if (para.to < text.length) {
    container.appendChild(document.createTextNode(text.slice(para.to)));
  }
}
