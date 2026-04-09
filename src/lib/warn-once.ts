const MAX_WARN_ONCE_KEYS = 200;
const warnedKeys = new Set<string>();

/**
 * Emit a warning only once per key to avoid flooding hot interactive paths.
 */
export function warnOnce(
  key: string,
  message: string,
  ...details: readonly unknown[]
): void {
  if (warnedKeys.has(key)) return;
  if (warnedKeys.size >= MAX_WARN_ONCE_KEYS) {
    warnedKeys.clear();
  }
  warnedKeys.add(key);
  console.warn(message, ...details);
}
