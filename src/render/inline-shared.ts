/**
 * Shared inline rendering utilities used by both the DOM renderer
 * (`inline-render.ts`) and rich preview renderers.
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
export { sanitizeCslHtml } from "../lib/sanitize-csl-html";
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
const katexErrorLogCache = new Set<string>();
export type KatexRenderOutputMode = "htmlAndMathml" | "html";

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
const MAX_KATEX_ERROR_LOG_ENTRIES = 200;

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
  outputMode: KatexRenderOutputMode,
  throwOnError: boolean,
): string {
  return serializeKatexMacros(macros)
    + "\0"
    + (isDisplay ? "D" : "I")
    + "\0"
    + outputMode
    + "\0"
    + (throwOnError ? "E" : "e")
    + "\0"
    + latex;
}

export function clearKatexHtmlCache(): void {
  katexHtmlCache.clear();
  katexErrorLogCache.clear();
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
  outputMode: KatexRenderOutputMode = "htmlAndMathml",
  throwOnError = false,
): string {
  const key = katexCacheKey(latex, isDisplay, macros, outputMode, throwOnError);
  const cached = katexHtmlCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let html: string;
  try {
    html = katex.renderToString(latex, {
      ...buildKatexOptions(isDisplay, macros),
      output: outputMode,
      throwOnError,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const logKey = `${key}\0${message}`;
    if (!katexErrorLogCache.has(logKey)) {
      if (katexErrorLogCache.size >= MAX_KATEX_ERROR_LOG_ENTRIES) {
        katexErrorLogCache.clear();
      }
      katexErrorLogCache.add(logKey);
      console.error("[katex] failed to render math", { latex, isDisplay }, error);
    }
    throw error;
  }

  const sanitized = sanitizeKatexHtml(html);
  if (katexHtmlCache.size >= MAX_KATEX_CACHE_ENTRIES) {
    katexHtmlCache.clear();
  }
  katexHtmlCache.set(key, sanitized);
  return sanitized;
}

// ── Rendered HTML sanitizer ─────────────────────────────────────────────────

const DANGEROUS_RENDERED_HTML_ELEMENTS: readonly string[] = [
  "script", "style", "noscript", "template", "iframe", "object", "embed",
];

const RENDERED_HTML_EXTRA_TAGS = ["semantics", "annotation"] as const;
const RENDERED_HTML_EXTRA_ATTRIBUTES = ["encoding"] as const;

let renderedHtmlPurify: ReturnType<typeof createDOMPurify> | null = null;

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
