/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Handles:
 * - Inline math ($...$ and \(...\)) via KaTeX
 * - Bold (**text**)
 * - Italic (*text*)
 *
 * Used by block header widgets, sidenote margin, and footnote section
 * to avoid duplicating the same parsing/rendering logic.
 */

import katex from "katex";
import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../parser";
import { stripMathDelimiters } from "./math-render";

/** Standalone Lezer parser for splitting inline math without a CM6 editor context. */
const inlineParser = baseParser.configure(markdownExtensions);

/** A segment of text split by inline math delimiters. */
export interface InlineSegment {
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

/**
 * Render a plain-text segment with bold/italic markdown into a container.
 * Appends child nodes (text, <strong>, <em>) to the container.
 */
function renderTextSegment(container: HTMLElement, text: string): void {
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      container.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    if (match[1] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = match[1];
      container.appendChild(strong);
    } else if (match[2] !== undefined) {
      const em = document.createElement("em");
      em.textContent = match[2];
      container.appendChild(em);
    }
    last = regex.lastIndex;
  }
  if (last < text.length) {
    container.appendChild(document.createTextNode(text.slice(last)));
  }
}

/**
 * Render inline markdown (math + bold + italic) into a DOM container.
 *
 * This is the single entry point for all inline content rendering in
 * widgets, sidenote panels, and footnote sections.
 *
 * @param container - The DOM element to append rendered content to.
 * @param text - Markdown text with optional $math$, **bold**, *italic*.
 * @param macros - KaTeX macro definitions from frontmatter.
 */
export function renderInlineMarkdown(
  container: HTMLElement,
  text: string,
  macros: Record<string, string> = {},
): void {
  for (const seg of splitByInlineMath(text)) {
    if (seg.isMath) {
      const span = document.createElement("span");
      try {
        span.innerHTML = katex.renderToString(seg.content, {
          throwOnError: false,
          displayMode: false,
          macros,
        });
      } catch {
        // KaTeX render failed — show raw LaTeX source as fallback
        span.textContent = `$${seg.content}$`;
      }
      container.appendChild(span);
    } else {
      renderTextSegment(container, seg.content);
    }
  }
}
