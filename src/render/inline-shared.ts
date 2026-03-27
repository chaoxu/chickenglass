/**
 * Shared inline rendering utilities used by both the DOM renderer
 * (`inline-render.ts`) and the HTML string renderer (`markdown-to-html.ts`).
 *
 * `buildKatexOptions` and `isSafeUrl` now live in `src/lib/` as they are
 * CM6-free utilities needed across multiple layers. Re-exported here for
 * backward compatibility.
 */

import DOMPurify from "dompurify";
import katex from "katex";
import { buildKatexOptions } from "../lib/katex-options";

// Re-export from canonical shared locations
export { buildKatexOptions } from "../lib/katex-options";
export { isSafeUrl } from "../lib/url-utils";

// ── Mark nodes ──────────────────────────────────────────────────────────────

/**
 * Lezer node names that are syntactic "marks" (delimiters) and should be
 * skipped when rendering inline content.
 */
export const MARK_NODES: ReadonlySet<string> = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "StrikethroughMark",
  "HighlightMark",
  "InlineMathMark",
  "HeaderMark",
  "ListMark",
  "TaskMarker",
  "TableDelimiter",
]);

// ── Shared KaTeX HTML cache ────────────────────────────────────────────────

const katexHtmlCache = new Map<string, string>();

function serializeKatexMacros(macros: Record<string, string>): string {
  const keys = Object.keys(macros);
  if (keys.length === 0) return "";
  keys.sort();
  return keys.map((key) => `${key}=${macros[key]}`).join("\0");
}

function katexCacheKey(
  latex: string,
  isDisplay: boolean,
  macros: Record<string, string>,
): string {
  return serializeKatexMacros(macros) + "\0" + (isDisplay ? "D" : "I") + "\0" + latex;
}

export function clearKatexHtmlCache(): void {
  katexHtmlCache.clear();
}

export function renderKatexToHtml(
  latex: string,
  isDisplay: boolean,
  macros: Record<string, string>,
): string {
  const key = katexCacheKey(latex, isDisplay, macros);
  const cached = katexHtmlCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const html = katex.renderToString(latex, {
    ...buildKatexOptions(isDisplay, macros),
    output: "htmlAndMathml",
  });
  katexHtmlCache.set(key, html);
  return html;
}

// ── CSL HTML sanitizer ──────────────────────────────────────────────────────

// Import isSafeUrl for local use in the DOMPurify hook
import { isSafeUrl } from "../lib/url-utils";

/**
 * Allowlist of HTML element names safe for CSL-formatted bibliography output.
 *
 * CSL styles produce formatting markup like `<i>`, `<b>`, `<sup>`, `<span>`.
 * Any element not in this list is stripped (its children are kept), unless it
 * is in DANGEROUS_CSL_ELEMENTS, in which case the element AND its content
 * are removed entirely.
 */
const SAFE_CSL_ELEMENTS: readonly string[] = [
  "a", "abbr", "b", "br", "cite", "code", "div", "em", "i", "mark",
  "p", "q", "s", "small", "span", "strong", "sub", "sup", "u",
];

/**
 * Element names whose content must be dropped entirely, not lifted.
 *
 * `<script>` and `<style>` content is raw text in the HTML parser — if the
 * element is removed while lifting its children, the raw text leaks into the
 * parent. Remove both the element and its children.
 */
const DANGEROUS_CSL_ELEMENTS: readonly string[] = [
  "script", "style", "noscript", "template", "iframe", "object",
  "embed", "form", "input", "textarea", "button", "select",
];

/**
 * Allowlist of HTML attribute names that are safe on CSL-output elements.
 *
 * `href` is included for `<a>` tags but its value is validated via `isSafeUrl`
 * in a DOMPurify `afterSanitizeAttributes` hook — see `cslPurify`.
 */
const SAFE_CSL_ATTRIBUTES: readonly string[] = [
  "class", "id", "href", "title",
];

/**
 * A DOMPurify instance configured for CSL bibliography HTML.
 *
 * Uses a dedicated instance (not the global singleton) so hooks and config
 * do not leak into other call sites.
 */
const cslPurify = DOMPurify();

// Validate href values through isSafeUrl after DOMPurify's own sanitization.
cslPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.hasAttribute("href")) {
    const href = node.getAttribute("href") ?? "";
    if (!isSafeUrl(href)) {
      node.removeAttribute("href");
    }
  }
});

/**
 * Sanitize HTML output from the CSL/citeproc engine for safe insertion via
 * `innerHTML`.
 *
 * The CSL engine may embed user-supplied bibliographic strings (titles, names,
 * URLs) directly inside its output. This function delegates to DOMPurify with
 * a CSL-specific allowlist:
 *   - Only elements in `SAFE_CSL_ELEMENTS` are kept.
 *   - Only attributes in `SAFE_CSL_ATTRIBUTES` are kept.
 *   - Dangerous elements (script, style, iframe, etc.) are removed along with
 *     their content via `FORBID_CONTENTS`.
 *   - `href` values are validated through `isSafeUrl`.
 *
 * Returns a sanitised HTML string.
 */
export function sanitizeCslHtml(raw: string): string {
  return cslPurify.sanitize(raw, {
    ALLOWED_TAGS: [...SAFE_CSL_ELEMENTS],
    ALLOWED_ATTR: [...SAFE_CSL_ATTRIBUTES],
    FORBID_CONTENTS: [...DANGEROUS_CSL_ELEMENTS],
  });
}
