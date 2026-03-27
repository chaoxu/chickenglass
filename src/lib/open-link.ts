/**
 * Open external URLs safely across browser and Tauri environments.
 *
 * In Tauri, delegates to the `open_url` backend command so the OS default
 * browser handles the URL. In the browser, falls back to `window.open`.
 */

import { isTauri } from "./tauri";
import { isSafeUrl } from "./url-utils";

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

  if (isTauri()) {
    try {
      const { invokeWithPerf } = await import("../app/perf");
      await invokeWithPerf("open_url", { url });
      return true;
    } catch (e: unknown) {
      console.error("[open-link] Tauri open_url failed:", e);
      return false;
    }
  }

  // Browser fallback
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
