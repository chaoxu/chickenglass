/**
 * Shared inline rendering utilities used by both the DOM renderer
 * (`inline-render.ts`) and the HTML string renderer (`markdown-to-html.ts`).
 *
 * `buildKatexOptions` and `isSafeUrl` now live in `src/lib/` as they are
 * CM6-free utilities needed across multiple layers. Re-exported here for
 * backward compatibility.
 */

import createDOMPurify from "dompurify";
import katex from "katex";
import { buildKatexOptions } from "../lib/katex-options";
import { isSafeUrl } from "../lib/url-utils";

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

/**
 * Maximum number of entries the KaTeX HTML cache may hold.
 *
 * Each entry is a (cacheKey → HTML string) pair.  Typical KaTeX output is
 * 1–5 KB, so 2 000 entries ≈ 2–10 MB.  This cap is a safety net — the
 * primary eviction path is the prewarm plugin clearing the cache when the
 * document state changes.  If the cache still overflows (e.g. very large
 * document with >2 000 unique expressions), the oldest entries are evicted
 * in bulk.
 */
const MAX_KATEX_CACHE_ENTRIES = 2000;

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

const KATEX_PURIFY_EXTRA_TAGS = ["semantics", "annotation"] as const;
const KATEX_PURIFY_EXTRA_ATTRIBUTES = ["encoding"] as const;
const KATEX_PURIFY_FORBID_TAGS = ["img"] as const;

let katexPurify: ReturnType<typeof createDOMPurify> | null = null;

function getKatexPurify(): ReturnType<typeof createDOMPurify> {
  if (katexPurify) {
    return katexPurify;
  }
  if (typeof window === "undefined") {
    throw new Error("sanitizeKatexHtml requires a browser-like window");
  }

  const purify = createDOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.hasAttribute("href")) {
      const href = node.getAttribute("href") ?? "";
      if (!isSafeUrl(href)) {
        node.removeAttribute("href");
      }
    }
  });
  katexPurify = purify;
  return purify;
}

function sanitizeKatexHtml(raw: string): string {
  return getKatexPurify().sanitize(raw, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_TAGS: [...KATEX_PURIFY_EXTRA_TAGS],
    ADD_ATTR: [...KATEX_PURIFY_EXTRA_ATTRIBUTES],
    FORBID_TAGS: [...KATEX_PURIFY_FORBID_TAGS],
  });
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
  const sanitized = sanitizeKatexHtml(html);
  if (katexHtmlCache.size >= MAX_KATEX_CACHE_ENTRIES) {
    katexHtmlCache.clear();
  }
  katexHtmlCache.set(key, sanitized);
  return sanitized;
}

// ── CSL HTML sanitizer ──────────────────────────────────────────────────────

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

const DANGEROUS_RENDERED_HTML_ELEMENTS: readonly string[] = [
  "script", "style", "noscript", "template", "iframe", "object", "embed",
];

const RENDERED_HTML_EXTRA_TAGS = ["semantics", "annotation"] as const;
const RENDERED_HTML_EXTRA_ATTRIBUTES = ["encoding"] as const;

/**
 * A DOMPurify instance configured for CSL bibliography HTML.
 *
 * Uses a dedicated instance (not the global singleton) so hooks and config
 * do not leak into other call sites.
 */
let cslPurify: ReturnType<typeof createDOMPurify> | null = null;
let renderedHtmlPurify: ReturnType<typeof createDOMPurify> | null = null;

function getCslPurify(): ReturnType<typeof createDOMPurify> {
  if (cslPurify) {
    return cslPurify;
  }
  if (typeof window === "undefined") {
    throw new Error("sanitizeCslHtml requires a browser-like window");
  }

  const purify = createDOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.hasAttribute("href")) {
      const href = node.getAttribute("href") ?? "";
      if (!isSafeUrl(href)) {
        node.removeAttribute("href");
      }
    }
  });
  cslPurify = purify;
  return purify;
}

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
  return getCslPurify().sanitize(raw, {
    ALLOWED_TAGS: [...SAFE_CSL_ELEMENTS],
    ALLOWED_ATTR: [...SAFE_CSL_ATTRIBUTES],
    FORBID_CONTENTS: [...DANGEROUS_CSL_ELEMENTS],
  });
}

function isSafeImageDataUrl(url: string): boolean {
  const cleaned = url.replace(/\s/g, "");
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(cleaned);
}

function isSafeRenderedHtmlUrl(
  attrName: "href" | "src",
  tagName: string,
  url: string,
): boolean {
  if (attrName === "src" && tagName.toLowerCase() === "img" && isSafeImageDataUrl(url)) {
    return true;
  }
  return isSafeUrl(url);
}

function getRenderedHtmlPurify(): ReturnType<typeof createDOMPurify> {
  if (renderedHtmlPurify) {
    return renderedHtmlPurify;
  }
  if (typeof window === "undefined") {
    throw new Error("sanitizeRenderedHtml requires a browser-like window");
  }

  const purify = createDOMPurify(window);
  purify.addHook("afterSanitizeAttributes", (node) => {
    const href = node.getAttribute("href");
    if (href && !isSafeRenderedHtmlUrl("href", node.tagName, href)) {
      node.removeAttribute("href");
    }

    const src = node.getAttribute("src");
    if (src && !isSafeRenderedHtmlUrl("src", node.tagName, src)) {
      node.removeAttribute("src");
    }
  });
  renderedHtmlPurify = purify;
  return purify;
}

export function sanitizeRenderedHtml(raw: string): string {
  return getRenderedHtmlPurify().sanitize(raw, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_TAGS: [...RENDERED_HTML_EXTRA_TAGS],
    ADD_ATTR: [...RENDERED_HTML_EXTRA_ATTRIBUTES],
    FORBID_CONTENTS: [...DANGEROUS_RENDERED_HTML_ELEMENTS],
  });
}
