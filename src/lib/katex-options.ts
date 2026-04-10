/**
 * Canonical KaTeX option builder.
 *
 * No dependency on React or DOM. Safe to use from editor, export, and tests.
 */

import type { KatexOptions } from "katex";

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
