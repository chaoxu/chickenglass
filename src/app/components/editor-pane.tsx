import { useRef, useEffect } from "react";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditorPaneProps extends UseEditorOptions {
  /** Called whenever the editor state changes (view, wordCount, cursorPos). */
  onStateChange?: (state: UseEditorReturn) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * EditorPane — mounts a CM6 editor into a managed container element.
 *
 * Forwards all UseEditorOptions to useEditor and notifies the parent of
 * state changes (view, wordCount, cursorPos) via onStateChange.
 */
export function EditorPane({ onStateChange, ...editorOptions }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const editorState = useEditor(containerRef, editorOptions);

  // Notify parent whenever the editor state changes.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  useEffect(() => {
    onStateChangeRef.current?.(editorState);
  }, [editorState]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden"
      style={{ minHeight: 0 }}
    />
  );
}
