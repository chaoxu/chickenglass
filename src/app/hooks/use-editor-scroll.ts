/**
 * useEditorScroll — tracks scroll position and viewport offset of a CM6 editor.
 *
 * Extracted from useEditor so scroll-tracking concerns are isolated.
 * Attaches a passive scroll listener to the editor's scrollDOM and
 * exposes reactive scrollTop / viewportFrom values.
 */

import { useState, useEffect, useCallback } from "react";
import type { EditorView } from "@codemirror/view";

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

  const resetScroll = useCallback(() => {
    setScrollTop(0);
    setViewportFrom(0);
  }, []);

  useEffect(() => {
    if (!view) return;

    const scroller = view.scrollDOM;
    const onScroll = () => {
      setScrollTop(scroller.scrollTop);
      // Use lineBlockAtHeight for accurate position
      const topPos = view.lineBlockAtHeight(scroller.scrollTop).from;
      setViewportFrom(topPos);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [view]);

  return { scrollTop, viewportFrom, resetScroll };
}
