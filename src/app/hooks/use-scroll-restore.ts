/**
 * Hook: scroll position restoration for read mode.
 *
 * Restores the provided scrollTop after each document render. Always sets
 * scrollTop (defaulting to 0) so switching documents resets the container
 * rather than keeping the previous file's position.
 */

import { useEffect, useRef, type RefObject } from "react";

export function useScrollRestore(
  containerRef: RefObject<HTMLElement | null>,
  htmlContent: string,
  scrollTop?: number,
): void {
  const didRestoreScroll = useRef(false);

  useEffect(() => {
    didRestoreScroll.current = false;
  }, [htmlContent]);

  // Restore scroll position after each document render.
  // Always set scrollTop (defaulting to 0) so that switching documents
  // resets the container rather than keeping the previous file's position.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || didRestoreScroll.current) return;
    didRestoreScroll.current = true;
    el.scrollTop = scrollTop ?? 0;
  }, [htmlContent, scrollTop, containerRef]);
}
