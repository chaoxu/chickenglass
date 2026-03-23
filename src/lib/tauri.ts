/**
 * Tauri runtime detection.
 *
 * No dependency on CM6 or React — safe to import from any layer.
 */

/** Check whether we're running inside a Tauri webview. */
export function isTauri(): boolean {
  return "__TAURI__" in window;
}
