import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Platform-aware modifier key label ("Cmd" on macOS, "Ctrl" elsewhere). */
export const isMac =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const modKey = isMac ? "Cmd" : "Ctrl";

/**
 * Return `s` with its first character uppercased.
 *
 * Used to derive display titles from plugin/block class names.
 */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Extract the last segment of a file path (the filename).
 *
 * Handles both forward-slash (Unix) and backslash (Windows) separators.
 * Returns the full input string if no separator is found.
 */
export function basename(path: string): string {
  return path.split("/").pop() ?? path.split("\\").pop() ?? path;
}

/**
 * Return the directory portion of a file path (everything before the last `/`).
 *
 * Returns an empty string when the path contains no separator,
 * matching the convention used throughout the codebase (relative paths
 * with forward slashes only, no Windows backslash handling needed).
 */
export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Convert a Uint8Array to a base64-encoded string.
 *
 * Uses `String.fromCharCode` + `btoa` — safe for binary data
 * because each byte is mapped to a single UTF-16 code unit.
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/**
 * Read a JSON value from localStorage, returning `fallback` on any error.
 *
 * Wraps `getItem` + `JSON.parse` in a try/catch so callers don't need to
 * handle missing keys, corrupt JSON, or unavailable storage (private
 * browsing, test environments).
 */
export function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
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
  } catch {
    // localStorage unavailable — ignore silently
  }
}
