/**
 * URL safety utilities.
 *
 * No dependency on CM6 or DOM — safe to use from any layer.
 */

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
