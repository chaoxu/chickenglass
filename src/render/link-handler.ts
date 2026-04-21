import { Decoration, type EditorView } from "@codemirror/view";

import { isSafeUrl } from "../lib/url-utils";
import { openExternalUrl } from "../lib/open-link";

const maxLinkDecorationCacheSize = 256;
const linkDecorationCache = new Map<string, Decoration>();

export function getLinkDecoration(url: string): Decoration {
  const cached = linkDecorationCache.get(url);
  if (cached) {
    linkDecorationCache.delete(url);
    linkDecorationCache.set(url, cached);
    return cached;
  }

  const linkDeco = Decoration.mark({
    class: "cf-link-rendered",
    attributes: { "data-url": url },
  });
  linkDecorationCache.set(url, linkDeco);
  if (linkDecorationCache.size > maxLinkDecorationCacheSize) {
    const oldestUrl = linkDecorationCache.keys().next().value;
    if (oldestUrl !== undefined) {
      linkDecorationCache.delete(oldestUrl);
    }
  }
  return linkDeco;
}

export function clearLinkDecorationCacheForTest(): void {
  linkDecorationCache.clear();
}

export function linkDecorationCacheSizeForTest(): number {
  return linkDecorationCache.size;
}

export function openRenderedLinkAtEvent(
  event: MouseEvent,
  _view: EditorView,
): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const linkEl = target.closest("[data-url]");
  if (!linkEl) return false;
  const url = linkEl.getAttribute("data-url");
  if (!url || !isSafeUrl(url)) return false;

  void openExternalUrl(url);
  event.preventDefault();
  return true;
}
