import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";

import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import type { DiagnosticEntry } from "../diagnostics";
import type { HeadingEntry } from "../heading-ancestry";
import type { UseEditorReturn } from "./use-editor";

export interface PendingLexicalNavigation {
  readonly onComplete?: () => void;
  readonly path: string;
  readonly pos: number;
}

export interface EditorSurfaceHandlesDeps {
  currentPath: string | null;
  editorDoc: string;
  editorHandleRef: MutableRefObject<MarkdownEditorHandle | null>;
  handleCmGotoLine: (line: number, col?: number) => void;
  handleCmOutlineSelect: (from: number) => void;
  syncView: (view: EditorView | null) => void;
}

export interface EditorSurfaceHandlesController {
  diagnostics: DiagnosticEntry[];
  editorState: UseEditorReturn | null;
  getLexicalEditorHandle: () => MarkdownEditorHandle | null;
  handleDiagnosticsChange: (diagnostics: DiagnosticEntry[]) => void;
  handleEditorStateChange: (state: UseEditorReturn) => void;
  handleGotoLine: (line: number, col?: number) => void;
  handleHeadingsChange: (headings: HeadingEntry[]) => void;
  handleInsertImage: () => void;
  handleLexicalEditorReady: (handle: MarkdownEditorHandle | null) => void;
  handleLexicalSurfaceReady: () => void;
  handleOutlineSelect: (from: number) => void;
  handleWatchedPathChange: (path: string) => void;
  headings: HeadingEntry[];
  queueLexicalNavigation: (navigation: PendingLexicalNavigation) => void;
  clearPendingLexicalNavigation: () => void;
}

export function useEditorSurfaceHandles({
  currentPath,
  editorDoc,
  editorHandleRef,
  handleCmGotoLine,
  handleCmOutlineSelect,
  syncView,
}: EditorSurfaceHandlesDeps): EditorSurfaceHandlesController {
  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const editorViewRef = useRef<EditorView | null>(null);
  const pendingLexicalNavigationRef = useRef<PendingLexicalNavigation | null>(null);

  const completeLexicalNavigation = useCallback(() => {
    const pending = pendingLexicalNavigationRef.current;
    const lexicalHandle = editorHandleRef.current;
    if (!pending || !lexicalHandle || pending.path !== currentPath) {
      return;
    }
    pendingLexicalNavigationRef.current = null;
    lexicalHandle.setSelection(pending.pos, pending.pos);
    lexicalHandle.focus();
    pending.onComplete?.();
  }, [currentPath, editorHandleRef]);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    editorViewRef.current = state.view;
    syncView(state.view);
  }, [syncView]);

  const handleLexicalSurfaceReady = useCallback(() => {
    setEditorState(null);
    editorViewRef.current = null;
    syncView(null);
    setHeadings([]);
    setDiagnostics([]);
  }, [syncView]);

  const handleLexicalEditorReady = useCallback((handle: MarkdownEditorHandle | null) => {
    editorHandleRef.current = handle;
    if (handle) {
      completeLexicalNavigation();
    }
  }, [completeLexicalNavigation, editorHandleRef]);

  const getLexicalEditorHandle = useCallback(() => editorHandleRef.current, [editorHandleRef]);

  const handleHeadingsChange = useCallback((nextHeadings: HeadingEntry[]) => {
    setHeadings(nextHeadings);
  }, []);

  const handleDiagnosticsChange = useCallback((nextDiagnostics: DiagnosticEntry[]) => {
    setDiagnostics(nextDiagnostics);
  }, []);

  const handleWatchedPathChange = useCallback((path: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    void import("../../render/image-url-cache").then(({ invalidateImageDataUrl }) => {
      if (editorViewRef.current !== view) return;
      invalidateImageDataUrl(view, path);
    });
  }, []);

  const handleInsertImage = useCallback(() => {
    const view = editorState?.view;
    if (view) {
      void import("../../editor").then(({ insertImageFromPicker }) => {
        if (editorViewRef.current !== view) return;
        void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
      });
    }
  }, [editorState?.view, editorState?.imageSaver]);

  const handleOutlineSelect = useCallback((from: number) => {
    const lexicalHandle = editorHandleRef.current;
    if (lexicalHandle) {
      lexicalHandle.setSelection(from, from);
      lexicalHandle.focus();
      return;
    }
    handleCmOutlineSelect(from);
  }, [editorHandleRef, handleCmOutlineSelect]);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    const lexicalHandle = editorHandleRef.current;
    if (lexicalHandle) {
      const doc = lexicalHandle.peekDoc();
      const lines = doc.split(/\r\n|\n|\r/);
      const clampedLine = Math.max(1, Math.min(line, lines.length));
      const lineStart = lines
        .slice(0, clampedLine - 1)
        .reduce((offset, currentLine) => offset + currentLine.length + 1, 0);
      const lineText = lines[clampedLine - 1] ?? "";
      const offset = lineStart + Math.max(0, Math.min((col ?? 1) - 1, lineText.length));
      lexicalHandle.setSelection(offset, offset);
      lexicalHandle.focus();
      return;
    }
    handleCmGotoLine(line, col);
  }, [editorHandleRef, handleCmGotoLine]);

  const queueLexicalNavigation = useCallback((navigation: PendingLexicalNavigation) => {
    pendingLexicalNavigationRef.current = navigation;
  }, []);

  const clearPendingLexicalNavigation = useCallback(() => {
    pendingLexicalNavigationRef.current = null;
  }, []);

  useEffect(() => {
    completeLexicalNavigation();
  }, [completeLexicalNavigation, editorDoc]);

  return {
    diagnostics,
    editorState,
    getLexicalEditorHandle,
    handleDiagnosticsChange,
    handleEditorStateChange,
    handleGotoLine,
    handleHeadingsChange,
    handleInsertImage,
    handleLexicalEditorReady,
    handleLexicalSurfaceReady,
    handleOutlineSelect,
    handleWatchedPathChange,
    headings,
    queueLexicalNavigation,
    clearPendingLexicalNavigation,
  };
}
