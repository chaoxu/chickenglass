import { useCallback, useEffect, useRef, useState } from "react";
import { computeLiveStats } from "../writing-stats";
import { Breadcrumbs } from "./breadcrumbs";
import {
  extractDiagnosticsFromAnalysis,
  type DiagnosticEntry,
} from "../diagnostics";
import { measureSync } from "../perf";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import { headingEntriesFromAnalysis, type HeadingEntry } from "../heading-ancestry";
import type { FileSystem } from "../file-manager";
import type { ResolvedTheme } from "../theme-dom";
import type { EditorMode } from "../../editor-display-mode";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";
import { REVEAL_MODE, type RevealMode } from "../../lexical/reveal-mode";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";
import { registerCoflatDecoratorRenderers } from "../../lexical/renderers/block-renderers";
import type { ProjectConfig } from "../../project-config";
import { getDocumentAnalysisSnapshot } from "../../semantics/incremental/cached-document-analysis";

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
  readonly cacheKey?: string;
  readonly chars: number;
  readonly diagnostics: DiagnosticEntry[];
  readonly diagnosticsEnabled: boolean;
  readonly doc: string;
  readonly headings: HeadingEntry[];
  readonly words: number;
}

interface LexicalPaneLiveCounts {
  readonly chars: number;
  readonly words: number;
}

interface LexicalPaneSemanticState {
  readonly diagnostics: DiagnosticEntry[];
  readonly headings: HeadingEntry[];
}

interface LexicalSemanticDeriveOptions {
  readonly cacheKey?: string;
  readonly includeDiagnostics: boolean;
}

type IdleTaskHandle = number;
type IdleTaskDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};
type WindowWithIdleTask = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleTaskDeadline) => void,
    options?: { readonly timeout?: number },
  ) => IdleTaskHandle;
  cancelIdleCallback?: (handle: IdleTaskHandle) => void;
};

const LEXICAL_LIVE_STATS_DEBOUNCE_MS = 300;
const LEXICAL_SEMANTIC_DERIVE_DEBOUNCE_MS = 300;
const LEXICAL_SEMANTIC_IDLE_TIMEOUT_MS = 1_000;

function deriveLexicalLiveCounts(doc: string): LexicalPaneLiveCounts {
  const counts = measureSync(
    "lexical.computeLiveStats",
    () => computeLiveStats(doc),
    { category: "lexical", detail: `${doc.length} chars` },
  );
  return {
    chars: counts.chars,
    words: counts.words,
  };
}

function deriveLexicalSemanticState(
  doc: string,
  options: LexicalSemanticDeriveOptions,
): LexicalPaneSemanticState {
  return measureSync("lexical.deriveSemanticState", () => {
    const analysis = measureSync(
      "lexical.deriveDocumentAnalysis",
      () => getDocumentAnalysisSnapshot(doc, options.cacheKey),
      { category: "lexical", detail: options.cacheKey ?? `${doc.length} chars` },
    );
    const headings = measureSync(
      "lexical.deriveHeadings",
      () => headingEntriesFromAnalysis(analysis),
      { category: "lexical", detail: `${analysis.headings.length} headings` },
    );
    let diagnostics: DiagnosticEntry[] = [];
    if (options.includeDiagnostics) {
      diagnostics = measureSync(
        "lexical.deriveDiagnostics",
        () => extractDiagnosticsFromAnalysis(analysis, {
          localOnlyWithoutBibliography: true,
        }),
        { category: "lexical", detail: `${analysis.references.length} refs` },
      );
    }

    return {
      diagnostics,
      headings,
    };
  }, { category: "lexical", detail: `${doc.length} chars` });
}

function deriveLexicalPaneState(
  doc: string,
  options: LexicalSemanticDeriveOptions,
): LexicalPaneDerivedState {
  return measureSync("lexical.derivePaneState", () => {
    const counts = deriveLexicalLiveCounts(doc);
    const semanticState = deriveLexicalSemanticState(doc, options);

    return {
      cacheKey: options.cacheKey,
      chars: counts.chars,
      diagnostics: semanticState.diagnostics,
      diagnosticsEnabled: options.includeDiagnostics,
      doc,
      headings: semanticState.headings,
      words: counts.words,
    };
  }, { category: "lexical", detail: `${doc.length} chars` });
}

function scheduleIdleTask(task: () => void): () => void {
  const idleWindow = window as WindowWithIdleTask;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(task, {
      timeout: LEXICAL_SEMANTIC_IDLE_TIMEOUT_MS,
    });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(task, 16);
  return () => window.clearTimeout(handle);
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
  const [initialDerivedState] = useState(() => deriveLexicalPaneState(editorOptions.doc, {
    cacheKey: editorOptions.docPath,
    includeDiagnostics: Boolean(onDiagnosticsChange),
  }));
  const derivedStateRef = useRef(initialDerivedState);
  const callbacksRef = useRef({
    onDiagnosticsChange,
    onHeadingsChange,
  });
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const currentDocRef = useRef(editorOptions.doc);
  const docVersionRef = useRef(0);
  const liveCountsTimerRef = useRef<number | null>(null);
  const semanticTimerRef = useRef<number | null>(null);
  const cancelSemanticIdleTaskRef = useRef<(() => void) | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>(initialDerivedState.headings);
  const [selection, setSelection] = useState<MarkdownEditorSelection>({
    anchor: 0,
    focus: 0,
    from: 0,
    to: 0,
  });
  const lexicalMode = toRevealMode(editorMode);

  const shouldDeriveDiagnostics = useCallback(
    () => Boolean(callbacksRef.current.onDiagnosticsChange),
    [],
  );

  const getDerivedState = useCallback((doc: string, includeDiagnostics: boolean) => {
    const cached = derivedStateRef.current;
    if (
      cached.doc === doc
      && cached.cacheKey === editorOptions.docPath
      && cached.diagnosticsEnabled === includeDiagnostics
    ) {
      return cached;
    }
    const nextState = deriveLexicalPaneState(doc, {
      cacheKey: editorOptions.docPath,
      includeDiagnostics,
    });
    derivedStateRef.current = nextState;
    return nextState;
  }, [editorOptions.docPath]);

  const cancelScheduledDerivedState = useCallback(() => {
    if (liveCountsTimerRef.current !== null) {
      window.clearTimeout(liveCountsTimerRef.current);
      liveCountsTimerRef.current = null;
    }
    if (semanticTimerRef.current !== null) {
      window.clearTimeout(semanticTimerRef.current);
      semanticTimerRef.current = null;
    }
    cancelSemanticIdleTaskRef.current?.();
    cancelSemanticIdleTaskRef.current = null;
  }, []);

  const applyImmediateDerivedState = useCallback((doc: string) => {
    const derivedState = getDerivedState(doc, shouldDeriveDiagnostics());
    setHeadings(derivedState.headings);
    useEditorTelemetryStore.getState().setLiveCounts(
      derivedState.words,
      derivedState.chars,
    );
    callbacksRef.current.onHeadingsChange?.(derivedState.headings);
    callbacksRef.current.onDiagnosticsChange?.(derivedState.diagnostics);
  }, [getDerivedState, shouldDeriveDiagnostics]);

  useEffect(() => {
    const previousCallbacks = callbacksRef.current;
    callbacksRef.current = {
      onDiagnosticsChange,
      onHeadingsChange,
    };
    const diagnosticsSubscriberChanged = onDiagnosticsChange !== undefined
      && onDiagnosticsChange !== previousCallbacks.onDiagnosticsChange;
    const headingsSubscriberChanged = onHeadingsChange !== undefined
      && onHeadingsChange !== previousCallbacks.onHeadingsChange;
    if (diagnosticsSubscriberChanged || headingsSubscriberChanged) {
      applyImmediateDerivedState(currentDocRef.current);
    }
  }, [applyImmediateDerivedState, onDiagnosticsChange, onHeadingsChange]);

  const scheduleLiveCounts = useCallback((doc: string, version: number) => {
    if (liveCountsTimerRef.current !== null) {
      window.clearTimeout(liveCountsTimerRef.current);
    }
    liveCountsTimerRef.current = window.setTimeout(() => {
      liveCountsTimerRef.current = null;
      if (docVersionRef.current !== version) {
        return;
      }
      const counts = deriveLexicalLiveCounts(doc);
      if (docVersionRef.current !== version) {
        return;
      }
      useEditorTelemetryStore.getState().setLiveCounts(counts.words, counts.chars);
    }, LEXICAL_LIVE_STATS_DEBOUNCE_MS);
  }, []);

  const scheduleSemanticState = useCallback((doc: string, version: number) => {
    if (semanticTimerRef.current !== null) {
      window.clearTimeout(semanticTimerRef.current);
    }
    cancelSemanticIdleTaskRef.current?.();
    cancelSemanticIdleTaskRef.current = null;

    semanticTimerRef.current = window.setTimeout(() => {
      semanticTimerRef.current = null;
      if (docVersionRef.current !== version) {
        return;
      }

      cancelSemanticIdleTaskRef.current = scheduleIdleTask(() => {
        cancelSemanticIdleTaskRef.current = null;
        if (docVersionRef.current !== version) {
          return;
        }
        const semanticState = deriveLexicalSemanticState(doc, {
          cacheKey: editorOptions.docPath,
          includeDiagnostics: shouldDeriveDiagnostics(),
        });
        if (docVersionRef.current !== version) {
          return;
        }
        setHeadings(semanticState.headings);
        callbacksRef.current.onHeadingsChange?.(semanticState.headings);
        callbacksRef.current.onDiagnosticsChange?.(semanticState.diagnostics);
      });
    }, LEXICAL_SEMANTIC_DERIVE_DEBOUNCE_MS);
  }, [editorOptions.docPath, shouldDeriveDiagnostics]);

  useEffect(() => {
    docVersionRef.current += 1;
    cancelScheduledDerivedState();
    currentDocRef.current = editorOptions.doc;
    applyImmediateDerivedState(editorOptions.doc);
    useEditorTelemetryStore.getState().setTelemetry({
      doc: editorOptions.doc,
    });
  }, [applyImmediateDerivedState, cancelScheduledDerivedState, editorOptions.doc]);

  useEffect(() => {
    return () => {
      cancelScheduledDerivedState();
    };
  }, [cancelScheduledDerivedState]);

  useEffect(() => {
    useEditorTelemetryStore.getState().setTelemetry({
      cursorPos: selection.focus,
    });
  }, [selection.focus]);

  const handleTextChange = useCallback((text: string) => {
    currentDocRef.current = text;
    docVersionRef.current += 1;
    const version = docVersionRef.current;
    scheduleLiveCounts(text, version);
    scheduleSemanticState(text, version);
  }, [scheduleLiveCounts, scheduleSemanticState]);

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
