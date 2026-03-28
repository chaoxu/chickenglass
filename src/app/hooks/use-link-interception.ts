/**
 * Hook: external link click interception.
 *
 * Intercepts clicks on anchor elements so the Tauri webview never navigates
 * away from the app. Delegates to the shared handleExternalLinkClick handler.
 */

import { useEffect, type RefObject } from "react";
import { handleExternalLinkClick } from "../../lib/open-link";

export function useLinkInterception(
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: MouseEvent) => {
      handleExternalLinkClick(e);
    };

    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [containerRef]);
}
