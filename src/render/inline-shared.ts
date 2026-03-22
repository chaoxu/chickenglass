/**
 * Shared inline rendering utilities used by both the DOM renderer
 * (`inline-render.ts`) and the HTML string renderer (`markdown-to-html.ts`).
 *
 * No dependency on CM6 or DOM — pure data and functions only.
 */

import type { KatexOptions } from "katex";

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

// ── URL safety ──────────────────────────────────────────────────────────────

/**
 * Check whether a URL is safe to embed in `href` or `src` attributes.
 *
 * Blocks `javascript:`, `data:`, and `vbscript:` schemes.
 */
export function isSafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return !(
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  );
}

// ── KaTeX option builder ────────────────────────────────────────────────────

/**
 * Build canonical KaTeX options for `katex.renderToString`.
 *
 * - `throwOnError: false` — render error boxes instead of throwing
 * - `trust` — allows `\href` / `\url` with `https?://` targets
 * - Macros are spread to avoid KaTeX mutation of the caller's object
 */
export function buildKatexOptions(
  displayMode: boolean,
  macros?: Record<string, string>,
): KatexOptions {
  return {
    displayMode,
    throwOnError: false,
    trust: (context: { command: string; url?: string }) =>
      (context.command === "\\href" || context.command === "\\url") &&
      context.url != null &&
      /^https?:\/\//.test(context.url),
    ...(macros ? { macros: { ...macros } } : {}),
  };
}
