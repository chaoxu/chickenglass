/**
 * useEditorScroll — tracks scroll position and viewport offset of a CM6 editor.
 *
 * Extracted from useEditor so scroll-tracking concerns are isolated.
 * Attaches a passive scroll listener to the editor's scrollDOM and
 * writes scroll telemetry (scrollTop, viewportFrom) directly to the
 * Zustand editorTelemetryStore — no React useState, so scrolling does
 * NOT trigger React re-renders of EditorPane or its children (#465).
 *
 * Debounces writes via requestAnimationFrame. After large scroll jumps
 * (> 2000px), schedules a CM6 requestMeasure() to ensure the viewport
 * is recalculated correctly (#463).
 */

import { useEffect, useCallback, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";

/**
 * Minimum scroll delta (in pixels) that triggers a CM6 requestMeasure().
 * Large jumps can leave the viewport blank because CM6's lazy rendering
 * hasn't caught up; requestMeasure() forces a remeasure cycle.
 */
const LARGE_SCROLL_THRESHOLD = 2000;

export interface UseEditorScrollReturn {
  /** Reset scroll state (call when editor is recreated). */
  resetScroll: () => void;
}

export function useEditorScroll(view: EditorView | null): UseEditorScrollReturn {
  const rafRef = useRef<number>(0);
  const lastScrollTopRef = useRef(0);

  const resetScroll = useCallback(() => {
    useEditorTelemetryStore.getState().setScroll(0, 0);
    lastScrollTopRef.current = 0;
  }, []);

  useEffect(() => {
    if (!view) return;

    const scroller = view.scrollDOM;

    let cancelled = false;

    const onScroll = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        if (cancelled) return;
        const currentTop = scroller.scrollTop;
        const delta = Math.abs(currentTop - lastScrollTopRef.current);
        lastScrollTopRef.current = currentTop;

        // Use lineBlockAtHeight for accurate position
        const topPos = view.lineBlockAtHeight(currentTop).from;

        // Write to Zustand store — no React setState, so no re-renders (#465).
        useEditorTelemetryStore.getState().setScroll(currentTop, topPos);

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
      cancelled = true;
      scroller.removeEventListener("scroll", onScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [view]);

  return { resetScroll };
}
