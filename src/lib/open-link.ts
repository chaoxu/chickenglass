/**
 * Open external URLs safely across browser and Tauri environments.
 *
 * The default behavior uses `window.open`. Hosts (e.g. the Tauri app shell)
 * can override this via `configureExternalUrlOpener` to route URLs through
 * a native handler instead.
 */

import { isSafeUrl } from "./url-utils";

/** Custom URL opener injected by the host (e.g. Tauri app shell). */
let customUrlOpener: ((url: string) => Promise<boolean>) | null = null;

/**
 * Register a custom handler for opening external URLs.
 *
 * When set, `openExternalUrl` delegates to this handler instead of
 * `window.open`. Pass `null` to restore the default browser behavior.
 */
export function configureExternalUrlOpener(
  opener: ((url: string) => Promise<boolean>) | null,
): void {
  customUrlOpener = opener;
}

/**
 * Open an external URL in the OS default browser (Tauri) or a new tab (browser).
 *
 * Only http/https URLs that pass `isSafeUrl` are opened. Returns `false` if
 * the URL was rejected or the open failed.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!url || !isSafeUrl(url)) return false;

  // Only open http(s) URLs externally — fragment, mailto, etc. are not handled here.
  const lower = url.trim().toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    return false;
  }

  if (customUrlOpener) {
    try {
      return await customUrlOpener(url);
    } catch (e: unknown) {
      console.error("[open-link] custom URL opener failed:", e);
      return false;
    }
  }

  // Browser default
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/**
 * Click handler for containers with `<a>` elements that should not navigate
 * the current window. Intercepts clicks on anchors with external `href`
 * values and opens them via `openExternalUrl`. Fragment-only links (e.g.
 * `#fn-1`, `#thm-evt`) are left alone so in-document navigation works.
 *
 * Attach to a container's `click` event. Returns `true` if the click was
 * handled (external link opened or blocked), `false` otherwise.
 */
export function handleExternalLinkClick(event: MouseEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  const anchor = target.closest("a");
  if (!anchor) return false;

  const href = anchor.getAttribute("href");
  if (!href) return false;

  // Fragment-only links — allow default in-document scroll behaviour.
  if (href.startsWith("#")) return false;

  // Prevent the webview from navigating away for any non-fragment link.
  event.preventDefault();

  // Open http(s) links externally (fire-and-forget).
  void openExternalUrl(href);
  return true;
}
