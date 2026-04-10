/**
 * URL safety utilities.
 *
 * No dependency on React or DOM — safe to use from any layer.
 */

/**
 * Protocols that are safe to use in `href` / `src` attributes.
 * Everything else (javascript:, data:, vbscript:, etc.) is blocked.
 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Check whether a URL is safe to embed in `href` or `src` attributes.
 *
 * Uses the standard URL API with an explicit protocol allowlist rather than
 * string-prefix blocking.  Relative URLs (paths, fragments, query-only)
 * resolve against a placeholder base and inherit its safe protocol, so they
 * are allowed.
 *
 * Edge cases handled:
 * - Leading/trailing whitespace and embedded newlines/tabs are stripped
 *   (mirrors browser URL parsing behaviour).
 * - Mixed-case schemes ("JavaScript:", "DATA:") are normalised by the URL
 *   constructor.
 * - Empty strings are treated as safe (no-op href).
 */
export function isSafeUrl(url: string): boolean {
  // Strip ASCII whitespace characters that browsers ignore inside URLs.
  // This covers leading/trailing spaces, tabs, and embedded newlines/CRs
  // that could be used to smuggle a dangerous scheme past a naive check.
  const cleaned = url.replace(/\s/g, "");

  if (cleaned === "") return true;

  try {
    // Relative URLs (paths, fragments, query-only) resolve against this
    // safe base and inherit its https: protocol, passing the allowlist.
    const parsed = new URL(cleaned, "https://placeholder.invalid");
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    // Malformed URLs that the URL constructor rejects are blocked.
    return false;
  }
}
