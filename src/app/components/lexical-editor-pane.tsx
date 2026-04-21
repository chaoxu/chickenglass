import { useCallback, useEffect, useRef, useState } from "react";
import { computeLiveStats } from "../writing-stats";
import { Breadcrumbs } from "./breadcrumbs";
import {
  buildDocumentLabelGraph,
  buildDocumentLabelParseSnapshot,
  isLikelyLocalReferenceId,
  type DocumentLabelGraph,
} from "../markdown/labels";
import { measureSync } from "../perf";
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
import { registerCoflatDecoratorRenderers } from "../../lexical/renderers/block-renderers";
import type { ProjectConfig } from "../../project-config";

registerCoflatDecoratorRenderers();

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

interface LexicalPaneDerivedState {
  readonly chars: number;
  readonly diagnostics: DiagnosticEntry[];
  readonly doc: string;
  readonly headings: HeadingEntry[];
  readonly words: number;
}

function extractDiagnosticsFromGraph(graph: DocumentLabelGraph): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];

  for (const [id, definitions] of graph.duplicatesById) {
    for (const definition of definitions) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate local target ID "${id}"`,
        from: definition.from,
        to: definition.to,
      });
    }
  }

  for (const reference of graph.references) {
    if (!isLikelyLocalReferenceId(reference.id)) {
      continue;
    }
    if (graph.definitionsById.has(reference.id)) {
      continue;
    }
    diagnostics.push({
      severity: "warning",
      message: `Unresolved reference "@${reference.id}"`,
      from: reference.from,
      to: reference.to,
    });
  }

  diagnostics.sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "error" ? -1 : 1;
    }
    return left.from - right.from;
  });

  return diagnostics;
}

function deriveLexicalPaneState(doc: string): LexicalPaneDerivedState {
  return measureSync("lexical.derivePaneState", () => {
    const counts = measureSync(
      "lexical.computeLiveStats",
      () => computeLiveStats(doc),
      { category: "lexical", detail: `${doc.length} chars` },
    );
    const snapshot = buildDocumentLabelParseSnapshot(doc);
    const headings = measureSync(
      "lexical.deriveHeadings",
      () => snapshot.headings.map(({ level, text, number, pos, id }) => ({
        level,
        text,
        number,
        pos,
        id,
      })),
      { category: "lexical", detail: `${snapshot.headings.length} headings` },
    );
    const graph = measureSync(
      "lexical.deriveLabelGraph",
      () => buildDocumentLabelGraph(doc, snapshot),
      { category: "lexical", detail: `${snapshot.references.length} refs` },
    );
    const diagnostics = measureSync(
      "lexical.deriveDiagnostics",
      () => extractDiagnosticsFromGraph(graph),
      { category: "lexical", detail: `${graph.references.length} refs` },
    );

    return {
      chars: counts.chars,
      diagnostics,
      doc,
      headings,
      words: counts.words,
    };
  }, { category: "lexical", detail: `${doc.length} chars` });
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
  const [initialDerivedState] = useState(() => deriveLexicalPaneState(editorOptions.doc));
  const derivedStateRef = useRef(initialDerivedState);
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const currentDocRef = useRef(editorOptions.doc);
  const [selection, setSelection] = useState<MarkdownEditorSelection>({
    anchor: 0,
    focus: 0,
    from: 0,
    to: 0,
  });
  const lexicalMode = toRevealMode(editorMode);

  const getDerivedState = useCallback((doc: string) => {
    const cached = derivedStateRef.current;
    if (cached.doc === doc) {
      return cached;
    }
    const nextState = deriveLexicalPaneState(doc);
    derivedStateRef.current = nextState;
    return nextState;
  }, []);

  const syncDocumentDerivedState = useCallback((doc: string) => {
    const derivedState = getDerivedState(doc);
    useEditorTelemetryStore.getState().setLiveCounts(
      derivedState.words,
      derivedState.chars,
    );
    onHeadingsChange?.(derivedState.headings);
    onDiagnosticsChange?.(derivedState.diagnostics);
  }, [getDerivedState, onDiagnosticsChange, onHeadingsChange]);

  useEffect(() => {
    currentDocRef.current = editorOptions.doc;
    syncDocumentDerivedState(editorOptions.doc);
    useEditorTelemetryStore.getState().setTelemetry({
      doc: editorOptions.doc,
    });
  }, [editorOptions.doc, syncDocumentDerivedState]);

  useEffect(() => {
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: selection.focus,
    });
  }, [selection.focus]);

  const handleTextChange = useCallback((text: string) => {
    currentDocRef.current = text;
    syncDocumentDerivedState(text);
  }, [syncDocumentDerivedState]);

  const handleSelectionChange = useCallback((nextSelection: MarkdownEditorSelection) => {
    setSelection(nextSelection);
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: nextSelection.focus,
      doc: currentDocRef.current,
    });
  }, []);

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

  const headings = getDerivedState(editorOptions.doc).headings;

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
