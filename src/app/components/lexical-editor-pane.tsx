import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorPluginManager } from "../../editor";
import { computeLiveStats } from "../writing-stats";
import { Breadcrumbs } from "./breadcrumbs";
import type { EditorPaneProps } from "./editor-pane";
import { extractDiagnosticsFromMarkdown } from "../markdown/diagnostics";
import { extractHeadingsFromMarkdown } from "../markdown/headings";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import { EDITOR_MODE, type EditorMode as LexicalEditorMode } from "../editor-mode";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";

interface LexicalEditorPaneProps extends EditorPaneProps {
  readonly onLexicalEditorReady?: (handle: MarkdownEditorHandle | null) => void;
}

function toLexicalEditorMode(mode: EditorPaneProps["editorMode"]): LexicalEditorMode {
  return mode === "source" ? EDITOR_MODE.SOURCE : EDITOR_MODE.LEXICAL;
}

export function LexicalEditorPane({
  activeDocumentSignal: _activeDocumentSignal,
  editorMode,
  onDiagnosticsChange,
  onDocumentReady: _onDocumentReady,
  onHeadingsChange,
  onLexicalEditorReady,
  onProgrammaticDocChange: _onProgrammaticDocChange,
  onSidenotesCollapsedChange: _onSidenotesCollapsedChange,
  onStateChange,
  pluginManager,
  projectConfig: _projectConfig,
  sidenotesCollapsed: _sidenotesCollapsed,
  theme: _theme,
  ...editorOptions
}: LexicalEditorPaneProps) {
  const fallbackPluginManager = useMemo(() => new EditorPluginManager(), []);
  const statePluginManager = pluginManager ?? fallbackPluginManager;
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const [selection, setSelection] = useState<MarkdownEditorSelection>({
    anchor: 0,
    focus: 0,
    from: 0,
    to: 0,
  });
  const lexicalMode = toLexicalEditorMode(editorMode);
  const editable = editorMode !== "read";

  const syncDocumentDerivedState = useCallback((doc: string) => {
    const counts = computeLiveStats(doc);
    useEditorTelemetryStore.getState().setLiveCounts(counts.words, counts.chars);
    onHeadingsChange?.(extractHeadingsFromMarkdown(doc));
    onDiagnosticsChange?.(extractDiagnosticsFromMarkdown(doc));
  }, [onDiagnosticsChange, onHeadingsChange]);

  useEffect(() => {
    onStateChange?.({
      imageSaver: null,
      pluginManager: statePluginManager,
      view: null,
    });
  }, [onStateChange, statePluginManager]);

  useEffect(() => {
    syncDocumentDerivedState(editorOptions.doc);
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: selection.focus,
      doc: editorOptions.doc,
    });
  }, [editorOptions.doc, selection.focus, syncDocumentDerivedState]);

  const handleTextChange = useCallback((text: string) => {
    syncDocumentDerivedState(text);
  }, [syncDocumentDerivedState]);

  const handleSelectionChange = useCallback((nextSelection: MarkdownEditorSelection) => {
    setSelection(nextSelection);
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: nextSelection.focus,
      doc: handleRef.current?.peekDoc() ?? editorOptions.doc,
    });
  }, [editorOptions.doc]);

  const handleEditorReady = useCallback((nextHandle: MarkdownEditorHandle) => {
    handleRef.current = nextHandle;
    setHandle(nextHandle);
    onLexicalEditorReady?.(nextHandle);
  }, [onLexicalEditorReady]);

  useEffect(() => {
    return () => {
      handleRef.current = null;
      onLexicalEditorReady?.(null);
    };
  }, [onLexicalEditorReady]);

  const headings = useMemo(
    () => extractHeadingsFromMarkdown(editorOptions.doc),
    [editorOptions.doc],
  );

  return (
    <div className="relative flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      {lexicalMode !== EDITOR_MODE.SOURCE && (
        <Breadcrumbs
          headings={headings}
          onSelect={(from) => {
            const nextHandle = handle;
            if (!nextHandle) return;
            nextHandle.setSelection(from, from);
            nextHandle.focus();
          }}
        />
      )}
      <LexicalMarkdownEditor
        doc={editorOptions.doc}
        docPath={editorOptions.docPath}
        editable={editable}
        editorMode={lexicalMode}
        onDocChange={editorOptions.onDocChange}
        onEditorReady={handleEditorReady}
        richChangePolicy="markdown"
        onSelectionChange={handleSelectionChange}
        onTextChange={handleTextChange}
        onScrollChange={(scrollTop) => {
          useEditorTelemetryStore.getState().setTelemetry({ scrollTop });
        }}
        onViewportFromChange={(viewportFrom) => {
          useEditorTelemetryStore.getState().setTelemetry({ viewportFrom });
        }}
      />
    </div>
  );
}
