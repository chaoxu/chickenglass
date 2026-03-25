/**
 * Framework-free utility functions shared across all layers.
 *
 * These are pure functions with no dependency on CM6, React, DOM, or any
 * framework — safe to import from plugins/, render/, semantics/, and app/.
 */

import {
  basename as patheBasename,
  dirname as patheDirname,
} from "pathe";

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
  return patheBasename(path);
}

/**
 * Return the directory portion of a file path (everything before the last `/`).
 *
 * Returns an empty string when the path contains no separator,
 * matching the convention used throughout the codebase (relative paths
 * with forward slashes only, no Windows backslash handling needed).
 *
 * Thin wrapper over pathe — maps its `"."` return to `""` to preserve
 * the falsy-check convention callers rely on (`dir ? \`${dir}/…\` : …`).
 */
export function dirname(path: string): string {
  const d = patheDirname(path);
  return d === "." ? "" : d;
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
 * Convert a base64-encoded string back to a Uint8Array.
 *
 * Inverse of `uint8ArrayToBase64` — uses `atob` + `charCodeAt`.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
