/**
 * Tauri runtime detection.
 *
 * No dependency on CM6 or React — safe to import from any layer.
 */

/** Check whether we're running inside a Tauri webview. */
export function isTauri(): boolean {
  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
  return typeof window !== "undefined" && (
    Boolean(tauriWindow.__TAURI_INTERNALS__)
    || Boolean((globalThis as typeof globalThis & { isTauri?: boolean }).isTauri)
  );
}
