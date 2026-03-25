/**
 * useEditorScroll — tracks scroll position and viewport offset of a CM6 editor.
 *
 * Extracted from useEditor so scroll-tracking concerns are isolated.
 * Attaches a passive scroll listener to the editor's scrollDOM and
 * exposes reactive scrollTop / viewportFrom values.
 *
 * Debounces React state updates via requestAnimationFrame to avoid
 * flooding React with re-renders during fast scrolling. After large
 * scroll jumps (> 2000px), schedules a CM6 requestMeasure() to ensure
 * the viewport is recalculated correctly (#463).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { EditorView } from "@codemirror/view";

/**
 * Minimum scroll delta (in pixels) that triggers a CM6 requestMeasure().
 * Large jumps can leave the viewport blank because CM6's lazy rendering
 * hasn't caught up; requestMeasure() forces a remeasure cycle.
 */
const LARGE_SCROLL_THRESHOLD = 2000;

export interface UseEditorScrollReturn {
  /** Current scroll top of the editor scroller (px). */
  scrollTop: number;
  /** Character offset of the first visible line in the viewport. */
  viewportFrom: number;
  /** Reset scroll state (call when editor is recreated). */
  resetScroll: () => void;
}

export function useEditorScroll(view: EditorView | null): UseEditorScrollReturn {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportFrom, setViewportFrom] = useState(0);
  const rafRef = useRef<number>(0);
  const lastScrollTopRef = useRef(0);

  const resetScroll = useCallback(() => {
    setScrollTop(0);
    setViewportFrom(0);
    lastScrollTopRef.current = 0;
  }, []);

  useEffect(() => {
    if (!view) return;

    const scroller = view.scrollDOM;

    const onScroll = () => {
      // Cancel any pending rAF to coalesce rapid scroll events into a
      // single React state update per animation frame.
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const currentTop = scroller.scrollTop;
        const delta = Math.abs(currentTop - lastScrollTopRef.current);
        lastScrollTopRef.current = currentTop;

        setScrollTop(currentTop);
        // Use lineBlockAtHeight for accurate position
        const topPos = view.lineBlockAtHeight(currentTop).from;
        setViewportFrom(topPos);

        // After a large scroll jump, CM6's lazy viewport rendering may
        // leave the visible area blank. Force a remeasure so CM6
        // recalculates which lines need to be drawn (#463).
        if (delta >= LARGE_SCROLL_THRESHOLD) {
          view.requestMeasure();
        }
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [view]);

  return { scrollTop, viewportFrom, resetScroll };
}
