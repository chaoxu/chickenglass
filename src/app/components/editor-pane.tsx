import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";

import { dispatchNavigateSourcePositionEvent } from "../../constants/events";
import { type MarkdownEditorHandle, type MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { computeLiveStats } from "../writing-stats";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import type { HeadingEntry } from "../heading-ancestry";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import { useHeadingIndex } from "../stores/heading-index-store";
import type { EditorDocumentChange } from "../editor-doc-change";
import type { EditorMode } from "../editor-mode";
import { Breadcrumbs } from "./breadcrumbs";
import { LexicalEditorSurface } from "./lexical-editor-surface";

export interface EditorPaneProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode: EditorMode;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onDocumentReady?: (docPath: string | undefined) => void;
  readonly onHeadingsChange?: (headings: HeadingEntry[]) => void;
  readonly onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  readonly onLexicalEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onOutlineSelect?: (from: number) => void;
  readonly spellCheck?: boolean;
}

export function EditorPane({
  doc,
  docPath,
  editorMode,
  onDocChange,
  onDocumentReady,
  onHeadingsChange,
  onDiagnosticsChange,
  onLexicalEditorReady,
  onOutlineSelect,
  spellCheck = false,
}: EditorPaneProps) {
  const [liveDoc, setLiveDoc] = useState(doc);
  const liveDocRef = useRef(doc);
  const richRootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    liveDocRef.current = liveDoc;
  }, [liveDoc]);

  useEffect(() => {
    setLiveDoc(doc);
    liveDocRef.current = doc;
    const counts = computeLiveStats(doc);
    const telemetry = useEditorTelemetryStore.getState();
    telemetry.setLiveCounts(counts.words, counts.chars);
    telemetry.setScroll(0, 0);
    telemetry.setCursorPos(0, doc);
  }, [doc]);

  const headings = useHeadingIndex((s) => s.headings);
  const diagnostics = useMemo(() => extractDiagnostics(liveDoc), [liveDoc]);

  useEffect(() => {
    onHeadingsChange?.(headings);
  }, [headings, onHeadingsChange]);

  useEffect(() => {
    onDiagnosticsChange?.(diagnostics);
  }, [diagnostics, onDiagnosticsChange]);

  const handleSelectionChange = useCallback((selection: MarkdownEditorSelection) => {
    const telemetry = useEditorTelemetryStore.getState();
    telemetry.setCursorPos(selection.focus, liveDocRef.current);
    telemetry.setScroll(telemetry.scrollTop, selection.from);
  }, []);

  const handleTextChange = useCallback((nextDoc: string) => {
    liveDocRef.current = nextDoc;
    setLiveDoc(nextDoc);
    const counts = computeLiveStats(nextDoc);
    useEditorTelemetryStore.getState().setLiveCounts(counts.words, counts.chars);
  }, []);

  const handleScrollChange = useCallback((scrollTop: number) => {
    const telemetry = useEditorTelemetryStore.getState();
    telemetry.setScroll(scrollTop, telemetry.viewportFrom);
  }, []);

  const handleViewportFromChange = useCallback((from: number) => {
    const telemetry = useEditorTelemetryStore.getState();
    telemetry.setScroll(telemetry.scrollTop, from);
  }, []);

  const handleRichRootElementChange = useCallback((root: HTMLElement | null) => {
    richRootRef.current = root;
  }, []);

  const handleHeadingNavigation = useCallback((from: number): boolean => {
    if (editorMode === "source" || !richRootRef.current) {
      return false;
    }

    dispatchNavigateSourcePositionEvent(from);
    return true;
  }, [editorMode]);

  const handleEditorReady = useCallback((handle: MarkdownEditorHandle, editor: LexicalEditor) => {
    onLexicalEditorReady?.(handle, editor);
  }, [onLexicalEditorReady]);

  const handleDocumentReady = useCallback(() => {
    onDocumentReady?.(docPath);
  }, [docPath, onDocumentReady]);

  return (
    <div className="relative flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      <Breadcrumbs
        headings={headings}
        onSelect={(from) => {
          if (!handleHeadingNavigation(from)) {
            onOutlineSelect?.(from);
          }
        }}
      />
      <LexicalEditorSurface
        doc={doc}
        docPath={docPath}
        editorMode={editorMode}
        onDocChange={onDocChange}
        onEditorReady={handleEditorReady}
        onRichRootElementChange={handleRichRootElementChange}
        onSelectionChange={handleSelectionChange}
        onTextChange={handleTextChange}
        onDocumentReady={handleDocumentReady}
        onScrollChange={handleScrollChange}
        onViewportFromChange={handleViewportFromChange}
        spellCheck={spellCheck}
      />
    </div>
  );
}
