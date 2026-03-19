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
import { INLINE_DELIMITERS } from "./math-render";

/** A segment of text split by inline math delimiters. */
export interface InlineSegment {
  isMath: boolean;
  content: string;
}

/** Escape a string for use in a regular expression. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex that matches any inline math delimiter pair.
 * Each alternative captures the content between its open/close delimiters.
 * Longer delimiters are tried first to avoid prefix conflicts.
 */
function buildInlineMathRegex(): RegExp {
  const alternatives = [...INLINE_DELIMITERS]
    .sort((a, b) => b.open.length - a.open.length)
    .map(({ open, close }) => `${escapeRegex(open)}([^\\n]+?)${escapeRegex(close)}`);
  return new RegExp(alternatives.join("|"), "g");
}

const INLINE_MATH_REGEX = buildInlineMathRegex();

/** Split text by inline math delimiters, returning alternating text/math segments. */
export function splitByInlineMath(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex = new RegExp(INLINE_MATH_REGEX.source, INLINE_MATH_REGEX.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isMath: false, content: text.slice(lastIndex, match.index) });
    }
    // Find the first capturing group that matched (one per delimiter pair)
    const content = match.slice(1).find((g) => g !== undefined);
    segments.push({ isMath: true, content: content ?? "" });
    lastIndex = regex.lastIndex;
  }

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
