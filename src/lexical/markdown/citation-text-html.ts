import katex from "katex";

import { buildKatexOptions } from "../../lib/katex-options";
import type { FrontmatterConfig } from "../../lib/frontmatter";
import { findNextInlineMathSource } from "../../lib/inline-math-source";
import { containsMarkdownMath } from "../../lib/markdown-math";

export interface CitationTextRenderOptions {
  readonly config?: FrontmatterConfig;
}

function encodeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInlineMath(source: string, options: CitationTextRenderOptions): string {
  return katex.renderToString(source, buildKatexOptions(false, options.config?.math));
}

/**
 * Render only TeX-style inline math inside citation/bibliography text.
 *
 * Bibliographic data is not document markdown: titles can contain literal
 * asterisks, underscores, URLs, and @-names. Keep those as text and only
 * upgrade math delimiters that authors intentionally placed in BibTeX.
 */
export function renderCitationTextHtml(
  text: string,
  options: CitationTextRenderOptions,
): string {
  if (!containsMarkdownMath(text)) {
    return encodeHtml(text);
  }

  const html: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const math = findNextInlineMathSource(text, cursor, { requireTightDollar: true });
    if (!math) {
      break;
    }
    html.push(encodeHtml(text.slice(cursor, math.from)));
    html.push(renderInlineMath(math.body, options));
    cursor = math.to;
  }

  html.push(encodeHtml(text.slice(cursor)));
  return html.join("");
}

export function renderCitationTextInHtml(
  html: string,
  options: CitationTextRenderOptions,
): string {
  if (typeof document === "undefined") {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const walker = document.createTreeWalker(
    template.content,
    document.defaultView?.NodeFilter.SHOW_TEXT ?? 4,
  );
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    if (!containsMarkdownMath(text)) {
      continue;
    }
    const wrapper = document.createElement("span");
    wrapper.innerHTML = renderCitationTextHtml(text, options);
    textNode.replaceWith(...wrapper.childNodes);
  }
  return template.innerHTML;
}
