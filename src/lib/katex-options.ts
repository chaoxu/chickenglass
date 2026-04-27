/**
 * Canonical KaTeX option builder.
 *
 * No dependency on CM6 or DOM — safe to use from both the CM6 renderer
 * (`inline-render.ts`) and the rich preview renderer.
 */

import type { KatexOptions } from "katex";

function normalizeKatexMacros(
  macros: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!macros) return undefined;

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(macros)) {
    if (!key.startsWith("\\")) continue;
    normalized[key] = value;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

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
  const normalizedMacros = normalizeKatexMacros(macros);
  return {
    displayMode,
    throwOnError: false,
    trust: (context: { command: string; url?: string }) =>
      (context.command === "\\href" || context.command === "\\url") &&
      context.url != null &&
      /^https?:\/\//.test(context.url),
    ...(normalizedMacros ? { macros: normalizedMacros } : {}),
  };
}
