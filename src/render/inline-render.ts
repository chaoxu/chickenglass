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
  "StrikethroughMark",
  "HighlightMark",
  "InlineMathMark",
]);

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
  container: HTMLElement | DocumentFragment,
): void {
  let pos = node.from;
  let child = node.firstChild;

  while (child) {
    // Text gap between previous position and this child
    if (child.from > pos) {
      container.appendChild(document.createTextNode(text.slice(pos, child.from)));
    }

    renderInlineNode(child, text, macros, container);
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
  container: HTMLElement | DocumentFragment,
): void {
  // Skip delimiter marks
  if (MARK_NODES.has(node.name)) {
    return;
  }

  switch (node.name) {
    case "Emphasis": {
      const em = document.createElement("em");
      renderChildren(node, text, macros, em);
      container.appendChild(em);
      return;
    }

    case "StrongEmphasis": {
      const strong = document.createElement("strong");
      renderChildren(node, text, macros, strong);
      container.appendChild(strong);
      return;
    }

    case "Strikethrough": {
      const del = document.createElement("del");
      renderChildren(node, text, macros, del);
      container.appendChild(del);
      return;
    }

    case "Highlight": {
      const mark = document.createElement("mark");
      renderChildren(node, text, macros, mark);
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

    case "Escape": {
      // \$ → $, \* → *, etc. — strip the backslash
      container.appendChild(document.createTextNode(text.slice(node.from + 1, node.to)));
      return;
    }

    case "HardBreak": {
      container.appendChild(document.createElement("br"));
      return;
    }

    default: {
      // Unknown inline node — render its text
      container.appendChild(document.createTextNode(text.slice(node.from, node.to)));
      return;
    }
  }
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

  renderChildren(para, text, macros, container);

  // Text after paragraph (e.g., trailing content not included by Lezer)
  if (para.to < text.length) {
    container.appendChild(document.createTextNode(text.slice(para.to)));
  }
}
