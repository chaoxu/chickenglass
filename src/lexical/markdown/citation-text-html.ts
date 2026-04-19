import katex from "katex";

import { buildKatexOptions } from "../../lib/katex-options";
import type { FrontmatterConfig } from "../../lib/frontmatter";
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

function findClosingDollar(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length) {
      index += 2;
      continue;
    }
    if (text[index] === "$") {
      return index;
    }
    index += 1;
  }
  return -1;
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
  let index = 0;

  while (index < text.length) {
    if (text.startsWith("\\(", index)) {
      const close = text.indexOf("\\)", index + 2);
      if (close >= 0) {
        html.push(encodeHtml(text.slice(cursor, index)));
        html.push(renderInlineMath(text.slice(index + 2, close), options));
        index = close + 2;
        cursor = index;
        continue;
      }
    }

    if (
      text[index] === "$"
      && text[index - 1] !== "\\"
      && text[index + 1] != null
      && !/\s/.test(text[index + 1])
    ) {
      const close = findClosingDollar(text, index + 1);
      if (close > index + 1 && !/\s/.test(text[close - 1])) {
        html.push(encodeHtml(text.slice(cursor, index)));
        html.push(renderInlineMath(text.slice(index + 1, close), options));
        index = close + 1;
        cursor = index;
        continue;
      }
    }

    index += 1;
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
