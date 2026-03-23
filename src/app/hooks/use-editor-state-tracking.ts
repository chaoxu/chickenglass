import { useRef, useEffect } from "react";
import type { UseEditorReturn } from "./use-editor";

/**
 * Fires `onStateChange` when any tracked editor metric actually changes,
 * avoiding spurious calls when unrelated renders occur.
 *
 * Tracked values: wordCount, cursorPos, scrollTop, and view presence.
 */
export function useEditorStateTracking(
  editorState: UseEditorReturn,
  onStateChange: ((state: UseEditorReturn) => void) | undefined,
): void {
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const { view, wordCount, cursorPos, scrollTop } = editorState;
  const prevRef = useRef({ wordCount: -1, cursorPos: -1, scrollTop: -1, hasView: false });

  useEffect(() => {
    const prev = prevRef.current;
    const hasView = view !== null;
    if (
      prev.wordCount === wordCount &&
      prev.cursorPos === cursorPos &&
      prev.scrollTop === scrollTop &&
      prev.hasView === hasView
    )
      return;
    prevRef.current = { wordCount, cursorPos, scrollTop, hasView };
    onStateChangeRef.current?.(editorState);
  }, [view, wordCount, cursorPos, scrollTop, editorState]);
}
