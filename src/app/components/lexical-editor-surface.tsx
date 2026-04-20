import { useCallback, useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";

import {
  type MarkdownEditorHandle,
  type MarkdownEditorSelection,
} from "../../lexical/markdown-editor-types";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";
import { registerCoflatDecoratorRenderers } from "../../lexical/renderers/block-renderers";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";
import type { EditorMode, RevealPresentation } from "../editor-mode";

registerCoflatDecoratorRenderers();

export interface LexicalEditorSurfaceProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode: EditorMode;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onDirtyChange?: () => void;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onRichRootElementChange?: (root: HTMLElement | null) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onDocumentReady?: () => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly spellCheck?: boolean;
  readonly revealPresentation?: RevealPresentation;
}

export function LexicalEditorSurface({
  doc,
  docPath,
  editorMode,
  onDocChange,
  onDirtyChange,
  onEditorReady,
  onRichRootElementChange,
  onSelectionChange,
  onTextChange,
  onDocumentReady,
  onScrollChange,
  onViewportFromChange,
  spellCheck = false,
  revealPresentation,
}: LexicalEditorSurfaceProps) {
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const readyPendingRef = useRef(false);

  const handleEditorReady = useCallback((handle: MarkdownEditorHandle, editor: LexicalEditor) => {
    handleRef.current = handle;
    onEditorReady?.(handle, editor);
    if (readyPendingRef.current) {
      readyPendingRef.current = false;
      onDocumentReady?.();
    }
  }, [onDocumentReady, onEditorReady]);

  useEffect(() => {
    if (!onDocumentReady) {
      return;
    }
    if (!onEditorReady) {
      onDocumentReady();
      return;
    }
    if (handleRef.current) {
      readyPendingRef.current = false;
      onDocumentReady();
      return;
    }
    readyPendingRef.current = true;
  }, [doc, editorMode, onDocumentReady, onEditorReady]);

  return (
    <LexicalMarkdownEditor
      doc={doc}
      docPath={docPath}
      editorMode={editorMode}
      editable
      editorClassName={[
        "cf-lexical-editor",
        editorMode === "source" ? "h-full" : "px-6 py-8 text-[var(--cf-fg)] outline-none",
      ].join(" ")}
      namespace="coflat-app-lexical-surface"
      onDocChange={onDocChange}
      onDirtyChange={onDirtyChange}
      onEditorReady={handleEditorReady}
      onRootElementChange={onRichRootElementChange}
      onScrollChange={onScrollChange}
      onSelectionChange={onSelectionChange}
      onTextChange={onTextChange}
      onViewportFromChange={onViewportFromChange}
      revealPresentation={revealPresentation}
      spellCheck={spellCheck}
    />
  );
}
