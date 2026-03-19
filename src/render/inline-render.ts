/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Handles:
 * - Inline math ($...$) via KaTeX
 * - Bold (**text**)
 * - Italic (*text*)
 *
 * Used by block header widgets, sidenote margin, and footnote section
 * to avoid duplicating the same parsing/rendering logic.
 */

import katex from "katex";

/** A segment of text split by inline math delimiters. */
export interface InlineSegment {
  isMath: boolean;
  content: string;
}

/** Split text by $...$ inline math, returning alternating text/math segments. */
export function splitByInlineMath(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const regex = /\$([^$\n]+)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isMath: false, content: text.slice(lastIndex, match.index) });
    }
    segments.push({ isMath: true, content: match[1] });
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
        span.textContent = `$${seg.content}$`;
      }
      container.appendChild(span);
    } else {
      renderTextSegment(container, seg.content);
    }
  }
}
