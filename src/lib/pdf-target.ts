/** Protocols that indicate an absolute URL (not a relative file path). */
const ABSOLUTE_URL_RE = /^(?:https?:|data:|blob:)/i;

/**
 * Returns true when `src` ends with `.pdf` (case-insensitive) and is a
 * relative path — not an absolute URL (http://, https://, data:, blob:).
 */
export function isPdfTarget(src: string): boolean {
  if (!src.toLowerCase().endsWith(".pdf")) return false;
  return !ABSOLUTE_URL_RE.test(src);
}
