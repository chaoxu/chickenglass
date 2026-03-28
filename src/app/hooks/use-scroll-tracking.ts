/**
 * Hook: passive scroll position tracking.
 *
 * Attaches a passive scroll listener that reports the current scrollTop
 * to the provided callback on every scroll event.
 */

import { useEffect, type RefObject } from "react";

export function useScrollTracking(
  containerRef: RefObject<HTMLElement | null>,
  onScroll?: (scrollTop: number) => void,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onScroll) return;

    const handler = () => {
      onScroll(el.scrollTop);
    };

    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [onScroll, containerRef]);
}
