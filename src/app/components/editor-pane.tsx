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

  // Notify parent when individual values change — NOT when the object
  // reference changes (which is every render since useEditor returns a
  // fresh object). This prevents an infinite re-render loop.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const { view, wordCount, cursorPos } = editorState;
  const prevRef = useRef({ wordCount: -1, cursorPos: -1, hasView: false });

  useEffect(() => {
    const prev = prevRef.current;
    const hasView = view !== null;
    if (prev.wordCount === wordCount && prev.cursorPos === cursorPos && prev.hasView === hasView) return;
    prevRef.current = { wordCount, cursorPos, hasView };
    onStateChangeRef.current?.(editorState);
  }, [view, wordCount, cursorPos, editorState]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden"
      style={{ minHeight: 0 }}
    />
  );
}
