import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeLiveStats } from "../writing-stats";
import { Breadcrumbs } from "./breadcrumbs";
import { extractDiagnosticsFromMarkdown } from "../markdown/diagnostics";
import { extractHeadingsFromMarkdown } from "../markdown/headings";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import type { DiagnosticEntry } from "../diagnostics";
import type { HeadingEntry } from "../heading-ancestry";
import type { FileSystem } from "../file-manager";
import type { ResolvedTheme } from "../theme-dom";
import type { EditorMode } from "../../editor-display-mode";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";
import { REVEAL_MODE, type RevealMode } from "../../lexical/reveal-mode";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";
import type { ProjectConfig } from "../../project-config";

interface LexicalEditorPaneProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly editorMode?: EditorMode;
  readonly fs?: FileSystem;
  readonly onDirtyChange?: () => void;
  readonly onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onHeadingsChange?: (headings: HeadingEntry[]) => void;
  readonly onLexicalEditorReady?: (handle: MarkdownEditorHandle | null) => void;
  readonly onProgrammaticDocChange?: (doc: string) => void;
  readonly onSurfaceReady?: () => void;
  readonly onSidenotesCollapsedChange?: (collapsed: boolean) => void;
  readonly projectConfig?: ProjectConfig;
  readonly sidenotesCollapsed?: boolean;
  readonly theme?: ResolvedTheme;
}

function toRevealMode(mode: EditorMode | undefined): RevealMode {
  return mode === "source" ? REVEAL_MODE.SOURCE : REVEAL_MODE.LEXICAL;
}

export function LexicalEditorPane({
  editorMode,
  onDiagnosticsChange,
  onDirtyChange,
  onHeadingsChange,
  onLexicalEditorReady,
  onProgrammaticDocChange: _onProgrammaticDocChange,
  onSurfaceReady,
  onSidenotesCollapsedChange: _onSidenotesCollapsedChange,
  projectConfig: _projectConfig,
  sidenotesCollapsed: _sidenotesCollapsed,
  theme: _theme,
  ...editorOptions
}: LexicalEditorPaneProps) {
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const [selection, setSelection] = useState<MarkdownEditorSelection>({
    anchor: 0,
    focus: 0,
    from: 0,
    to: 0,
  });
  const lexicalMode = toRevealMode(editorMode);

  const syncDocumentDerivedState = useCallback((doc: string) => {
    const counts = computeLiveStats(doc);
    useEditorTelemetryStore.getState().setLiveCounts(counts.words, counts.chars);
    onHeadingsChange?.(extractHeadingsFromMarkdown(doc));
    onDiagnosticsChange?.(extractDiagnosticsFromMarkdown(doc));
  }, [onDiagnosticsChange, onHeadingsChange]);

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

  useEffect(() => {
    onSurfaceReady?.();
  }, [onSurfaceReady]);

  const headings = useMemo(
    () => extractHeadingsFromMarkdown(editorOptions.doc),
    [editorOptions.doc],
  );

  return (
    <div className="relative flex-1 overflow-hidden" style={{ minHeight: 0 }}>
      {lexicalMode !== REVEAL_MODE.SOURCE && (
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
        editable
        editorMode={lexicalMode}
        onDocChange={editorOptions.onDocChange}
        onDirtyChange={onDirtyChange}
        onEditorReady={handleEditorReady}
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
