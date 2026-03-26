/** Protocols that indicate an absolute URL (not a relative file path). */
const ABSOLUTE_URL_RE = /^(?:https?:|data:|blob:)/i;

/**
 * Returns true when `src` is a relative file path — not an absolute URL
 * (http://, https://, data:, blob:).
 *
 * Used by image rendering (#471) and PDF detection to decide whether a
 * path should be resolved relative to the current document.
 */
export function isRelativeFilePath(src: string): boolean {
  return !ABSOLUTE_URL_RE.test(src);
}

/**
 * Returns true when `src` ends with `.pdf` (case-insensitive) and is a
 * relative path — not an absolute URL (http://, https://, data:, blob:).
 */
export function isPdfTarget(src: string): boolean {
  if (!src.toLowerCase().endsWith(".pdf")) return false;
  return isRelativeFilePath(src);
}
