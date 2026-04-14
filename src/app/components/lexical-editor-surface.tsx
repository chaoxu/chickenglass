import { useCallback, useEffect, useRef } from "react";
import type { LexicalEditor } from "lexical";

import {
  type MarkdownEditorHandle,
  type MarkdownEditorSelection,
} from "../../lexical/markdown-editor-types";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";
// Side-effect import binds block renderers to their node registries before any
// editor mounts. See nodes/footnote-reference-renderer-registry.ts and
// nodes/raw-block-renderer-registry.ts.
import "../../lexical/renderers/block-renderers";
import { FORMAT_EVENT, type FormatEventDetail } from "../../constants/events";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";
import type { EditorMode } from "../editor-mode";
import { planMarkdownFormat } from "../format-markdown";

export interface LexicalEditorSurfaceProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode: EditorMode;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onRichRootElementChange?: (root: HTMLElement | null) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly onDocumentReady?: () => void;
  readonly onScrollChange?: (scrollTop: number) => void;
  readonly onViewportFromChange?: (from: number) => void;
  readonly spellCheck?: boolean;
}

export function LexicalEditorSurface({
  doc,
  docPath,
  editorMode,
  onDocChange,
  onEditorReady,
  onRichRootElementChange,
  onSelectionChange,
  onTextChange,
  onDocumentReady,
  onScrollChange,
  onViewportFromChange,
  spellCheck = false,
}: LexicalEditorSurfaceProps) {
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const docRef = useRef(doc);
  const readyPendingRef = useRef(false);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

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

  useEffect(() => {
    const handleFormat = (event: Event) => {
      const detail = (event as CustomEvent<FormatEventDetail>).detail;
      if (
        editorMode !== "source"
        && (
          detail.type === "bold"
          || detail.type === "code"
          || detail.type === "highlight"
          || detail.type === "italic"
          || detail.type === "strikethrough"
        )
      ) {
        return;
      }

      const handle = handleRef.current;
      if (!handle) {
        return;
      }
      const plan = planMarkdownFormat(docRef.current, handle.getSelection(), detail);
      handle.applyChanges(plan.changes);
      handle.setSelection(plan.selection.anchor, plan.selection.focus);
      handle.focus();
    };

    document.addEventListener(FORMAT_EVENT, handleFormat);
    return () => {
      document.removeEventListener(FORMAT_EVENT, handleFormat);
    };
  }, [editorMode]);

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
      onEditorReady={handleEditorReady}
      onRootElementChange={onRichRootElementChange}
      onScrollChange={onScrollChange}
      onSelectionChange={onSelectionChange}
      onTextChange={onTextChange}
      onViewportFromChange={onViewportFromChange}
      spellCheck={spellCheck}
    />
  );
}
