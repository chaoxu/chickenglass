import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Platform-aware modifier key label ("Cmd" on macOS, "Ctrl" elsewhere). */
export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const modKey = isMac ? "Cmd" : "Ctrl";

// ── Re-exports from canonical shared location ───────────────────────────────
// Framework-free utils now live in `src/lib/utils.ts`. Re-exported here for
// backward compatibility so existing `app/` imports continue to work.
export { capitalize, basename, dirname, uint8ArrayToBase64, base64ToUint8Array } from "../../lib/utils";

/**
 * Read a JSON value from localStorage, returning `fallback` on any error.
 *
 * Wraps `getItem` + `JSON.parse` in a try/catch so callers don't need to
 * handle missing keys, corrupt JSON, or unavailable storage (private
 * browsing, test environments).
 *
 * JSON.parse returns `unknown`; the cast to `T` is intentional — callers
 * are responsible for validating the shape of the returned value (e.g., by
 * using `T = unknown` and narrowing afterwards, as is done in recent-files.ts
 * and window-state.ts).
 */
export function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return parsed as T;
  } catch (_e) {
    // best-effort: corrupt JSON or unavailable storage — return fallback
    return fallback;
  }
}

/**
 * Write a JSON-serialisable value to localStorage.
 *
 * Silently ignores errors (quota exceeded, private browsing, tests).
 */
export function writeLocalStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_e) {
    // best-effort: localStorage unavailable (quota exceeded, private browsing, tests)
  }
}
