import { useRef, useEffect } from "react";
import type { UseEditorReturn } from "./use-editor";

/**
 * Fires `onStateChange` when the editor view presence changes.
 *
 * Cursor position and word count are now tracked in the Zustand
 * `editorTelemetryStore` and no longer flow through this hook.
 * This hook only notifies the parent when the CM6 view is created or
 * destroyed so it can update headings and the latestViewRef.
 */
export function useEditorStateTracking(
  editorState: UseEditorReturn,
  onStateChange: ((state: UseEditorReturn) => void) | undefined,
): void {
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const { view } = editorState;
  const prevHasViewRef = useRef(false);

  useEffect(() => {
    const hasView = view !== null;
    if (prevHasViewRef.current === hasView) return;
    prevHasViewRef.current = hasView;
    onStateChangeRef.current?.(editorState);
  }, [view, editorState]);
}
