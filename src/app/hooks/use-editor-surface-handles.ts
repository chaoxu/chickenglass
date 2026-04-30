import { useCallback, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

import { insertImageFromPicker } from "../../editor/image-insert";
import { invalidateImageDataUrl } from "../../render/image-url-cache";
import { invalidatePdfPreview } from "../../render/pdf-preview-cache";
import type { DiagnosticEntry } from "../diagnostics";
import type { HeadingEntry } from "../heading-ancestry";
import type { UseEditorReturn } from "./use-editor";

export interface EditorSurfaceHandlesDeps {
  handleCmGotoLine: (line: number, col?: number) => void;
  handleCmOutlineSelect: (from: number) => void;
  syncView: (view: EditorView | null) => void;
}

export interface EditorSurfaceHandlesController {
  diagnostics: DiagnosticEntry[];
  editorState: UseEditorReturn | null;
  handleDiagnosticsChange: (diagnostics: DiagnosticEntry[]) => void;
  handleEditorStateChange: (state: UseEditorReturn) => void;
  handleGotoLine: (line: number, col?: number) => void;
  handleHeadingsChange: (headings: HeadingEntry[]) => void;
  handleInsertImage: () => void;
  handleOutlineSelect: (from: number) => void;
  handleWatchedPathChange: (path: string) => void;
  headings: HeadingEntry[];
}

export function useEditorSurfaceHandles({
  handleCmGotoLine,
  handleCmOutlineSelect,
  syncView,
}: EditorSurfaceHandlesDeps): EditorSurfaceHandlesController {
  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const editorViewRef = useRef<EditorView | null>(null);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    editorViewRef.current = state.view;
    syncView(state.view);
  }, [syncView]);

  const handleHeadingsChange = useCallback((nextHeadings: HeadingEntry[]) => {
    setHeadings(nextHeadings);
  }, []);

  const handleDiagnosticsChange = useCallback((nextDiagnostics: DiagnosticEntry[]) => {
    setDiagnostics(nextDiagnostics);
  }, []);

  const handleWatchedPathChange = useCallback((path: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    invalidateImageDataUrl(view, path);
    invalidatePdfPreview(view, path);
  }, []);

  const handleInsertImage = useCallback(() => {
    const view = editorState?.view;
    if (view) {
      void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
      return;
    }

    console.warn("[editor] Insert Image is unavailable until an editor surface is ready.");
  }, [editorState?.view, editorState?.imageSaver]);

  const handleOutlineSelect = useCallback((from: number) => {
    handleCmOutlineSelect(from);
  }, [handleCmOutlineSelect]);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    handleCmGotoLine(line, col);
  }, [handleCmGotoLine]);

  return {
    diagnostics,
    editorState,
    handleDiagnosticsChange,
    handleEditorStateChange,
    handleGotoLine,
    handleHeadingsChange,
    handleInsertImage,
    handleOutlineSelect,
    handleWatchedPathChange,
    headings,
  };
}
