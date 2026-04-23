import { useCallback, useEffect, useRef, useState } from "react";
import { computeLiveStats } from "../writing-stats";
import { Breadcrumbs } from "./breadcrumbs";
import type { DiagnosticEntry } from "../diagnostics";
import { measureSync } from "../perf";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import type { HeadingEntry } from "../heading-ancestry";
import {
  deriveSidebarSemanticState,
  type SidebarSemanticState,
} from "./sidebar-semantic-state";
import type { FileSystem } from "../file-manager";
import type { ResolvedTheme } from "../theme-dom";
import type { EditorMode } from "../../editor-display-mode";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";
import { REVEAL_MODE, type RevealMode } from "../../lexical/reveal-mode";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";
import type { ProjectConfig } from "../../project-config";
import { getDocumentAnalysisSnapshot } from "../../semantics/incremental/cached-document-analysis";

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

interface LexicalPaneLiveCounts {
  readonly chars: number;
  readonly words: number;
}

interface LexicalPaneSemanticState extends SidebarSemanticState {
  readonly cacheKey?: string;
  readonly doc: string;
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
  previous?: LexicalPaneSemanticState,
): LexicalPaneSemanticState {
  return measureSync("lexical.deriveSemanticState", () => {
    const analysis = measureSync(
      "lexical.deriveDocumentAnalysis",
      () => getDocumentAnalysisSnapshot(doc, options.cacheKey),
      { category: "lexical", detail: options.cacheKey ?? `${doc.length} chars` },
    );
    const previousState = previous;
    const nextState = deriveSidebarSemanticState(analysis, {
      includeDiagnostics: options.includeDiagnostics,
      localOnlyWithoutBibliography: true,
      metricPrefix: "lexical",
      reuseByRevision: Boolean(options.cacheKey),
    }, previousState);

    return {
      cacheKey: options.cacheKey,
      doc,
      ...nextState,
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
  const [initialSemanticState] = useState(() => deriveLexicalSemanticState(editorOptions.doc, {
    cacheKey: editorOptions.docPath,
    includeDiagnostics: Boolean(onDiagnosticsChange),
  }));
  const semanticStateRef = useRef(initialSemanticState);
  const callbacksRef = useRef({
    onDiagnosticsChange,
    onHeadingsChange,
  });
  const publishedHeadingsRef = useRef<readonly HeadingEntry[] | null>(null);
  const publishedDiagnosticsRef = useRef<readonly DiagnosticEntry[] | null>(null);
  const [handle, setHandle] = useState<MarkdownEditorHandle | null>(null);
  const handleRef = useRef<MarkdownEditorHandle | null>(null);
  const currentDocRef = useRef(editorOptions.doc);
  const docVersionRef = useRef(0);
  const liveCountsTimerRef = useRef<number | null>(null);
  const semanticTimerRef = useRef<number | null>(null);
  const cancelSemanticIdleTaskRef = useRef<(() => void) | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>(initialSemanticState.headings);
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

  const getSemanticState = useCallback((doc: string, includeDiagnostics: boolean) => {
    const cached = semanticStateRef.current;
    if (
      cached.doc === doc
      && cached.cacheKey === editorOptions.docPath
      && cached.diagnosticsEnabled === includeDiagnostics
    ) {
      return cached;
    }
    const nextState = deriveLexicalSemanticState(doc, {
      cacheKey: editorOptions.docPath,
      includeDiagnostics,
    }, cached);
    semanticStateRef.current = nextState;
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

  const syncLiveCounts = useCallback((doc: string) => {
    const counts = deriveLexicalLiveCounts(doc);
    useEditorTelemetryStore.getState().setLiveCounts(counts.words, counts.chars);
  }, []);

  const publishSemanticState = useCallback((
    semanticState: LexicalPaneSemanticState,
    options: {
      readonly force?: boolean;
      readonly publishDiagnostics?: boolean;
      readonly publishHeadings?: boolean;
      readonly updateHeadingState?: boolean;
    } = {},
  ) => {
    const {
      force = false,
      publishDiagnostics = true,
      publishHeadings = true,
      updateHeadingState = true,
    } = options;
    if (updateHeadingState) {
      setHeadings(semanticState.headings);
    }
    if (publishHeadings && (force || publishedHeadingsRef.current !== semanticState.headings)) {
      measureSync("lexical.publishHeadings", () => {
        callbacksRef.current.onHeadingsChange?.(semanticState.headings);
      }, {
        category: "lexical",
        detail: `${semanticState.headings.length} headings`,
      });
      publishedHeadingsRef.current = semanticState.headings;
    }
    if (publishDiagnostics && callbacksRef.current.onDiagnosticsChange) {
      if (force || publishedDiagnosticsRef.current !== semanticState.diagnostics) {
        measureSync("lexical.publishDiagnostics", () => {
          callbacksRef.current.onDiagnosticsChange?.(semanticState.diagnostics);
        }, {
          category: "lexical",
          detail: `${semanticState.diagnostics.length} diagnostics`,
        });
      }
      publishedDiagnosticsRef.current = semanticState.diagnostics;
      return;
    }
    if (publishDiagnostics) {
      publishedDiagnosticsRef.current = semanticState.diagnostics;
    }
  }, []);

  const applyImmediateState = useCallback((
    doc: string,
    options: { readonly forcePublish?: boolean } = {},
  ) => {
    const semanticState = getSemanticState(doc, shouldDeriveDiagnostics());
    syncLiveCounts(doc);
    publishSemanticState(semanticState, { force: options.forcePublish });
  }, [getSemanticState, publishSemanticState, shouldDeriveDiagnostics, syncLiveCounts]);

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
      const semanticState = getSemanticState(
        currentDocRef.current,
        shouldDeriveDiagnostics(),
      );
      publishSemanticState(semanticState, {
        force: true,
        publishDiagnostics: diagnosticsSubscriberChanged,
        publishHeadings: headingsSubscriberChanged,
        updateHeadingState: false,
      });
    }
  }, [
    getSemanticState,
    onDiagnosticsChange,
    onHeadingsChange,
    publishSemanticState,
    shouldDeriveDiagnostics,
  ]);

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
        const semanticState = getSemanticState(doc, shouldDeriveDiagnostics());
        if (docVersionRef.current !== version) {
          return;
        }
        publishSemanticState(semanticState);
      });
    }, LEXICAL_SEMANTIC_DERIVE_DEBOUNCE_MS);
  }, [getSemanticState, publishSemanticState, shouldDeriveDiagnostics]);

  useEffect(() => {
    docVersionRef.current += 1;
    cancelScheduledDerivedState();
    currentDocRef.current = editorOptions.doc;
    semanticStateRef.current = deriveLexicalSemanticState(editorOptions.doc, {
      cacheKey: editorOptions.docPath,
      includeDiagnostics: shouldDeriveDiagnostics(),
    });
    publishedHeadingsRef.current = null;
    publishedDiagnosticsRef.current = null;
    applyImmediateState(editorOptions.doc, { forcePublish: true });
    useEditorTelemetryStore.getState().setTelemetry({
      doc: editorOptions.doc,
    });
  }, [
    applyImmediateState,
    cancelScheduledDerivedState,
    editorOptions.doc,
    editorOptions.docPath,
    shouldDeriveDiagnostics,
  ]);

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
