import { useRef, useEffect } from "react";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";
import { Breadcrumbs } from "./breadcrumbs";
import { SidenoteMargin } from "./sidenote-margin";
import { extractHeadings } from "../heading-ancestry";

export interface EditorPaneProps extends UseEditorOptions {
  onStateChange?: (state: UseEditorReturn) => void;
}

export function EditorPane({ onStateChange, ...editorOptions }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorState = useEditor(containerRef, editorOptions);

  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);

  const { view, wordCount, cursorPos, scrollTop, viewportFrom } = editorState;
  const prevRef = useRef({ wordCount: -1, cursorPos: -1, scrollTop: -1, hasView: false });

  useEffect(() => {
    const prev = prevRef.current;
    const hasView = view !== null;
    if (
      prev.wordCount === wordCount &&
      prev.cursorPos === cursorPos &&
      prev.scrollTop === scrollTop &&
      prev.hasView === hasView
    ) return;
    prevRef.current = { wordCount, cursorPos, scrollTop, hasView };
    onStateChangeRef.current?.(editorState);
  }, [view, wordCount, cursorPos, scrollTop, editorState]);

  // Extract headings for breadcrumbs
  const headings = view
    ? extractHeadings(view.state).map((h) => ({ level: h.level, text: h.text, from: h.pos }))
    : [];

  return (
    <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
      <Breadcrumbs
        headings={headings}
        onSelect={(from) => {
          if (view) {
            view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
            view.focus();
          }
        }}
        scrollTop={scrollTop}
        viewportFrom={viewportFrom}
      />
      <div ref={containerRef} className="h-full" />
      <SidenoteMargin view={view} scrollTop={scrollTop} />
    </div>
  );
}
