import { useCallback, useEffect, useRef, useState } from "react";
import { LexicalMarkdownEditor } from "../../lexical/markdown-editor";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "../../lexical/markdown-editor-types";
import { REVEAL_MODE, type RevealMode } from "../../lexical/reveal-mode";
import {
  mergeConfigs,
  type ProjectConfig,
  type ProjectConfigStatus,
} from "../../project-config";
import { parseFrontmatter } from "../../parser/frontmatter";
import type { BibliographyStatus } from "../../state/bib-data";
import { getDocumentAnalysisSnapshot } from "../../semantics/incremental/cached-document-analysis";
import {
  compareDiagnostics,
  sameDiagnosticEntries,
  type DiagnosticEntry,
} from "../diagnostics";
import {
  diagnosticFromBibliographyStatus,
  diagnosticFromFrontmatterStatus,
  diagnosticFromProjectConfigStatus,
  diagnosticStatusKey,
} from "../diagnostic-status";
import type { EditorDocumentChange } from "../editor-doc-change";
import type { FileSystem } from "../file-manager";
import { loadBibliographyData } from "../hooks/use-bibliography";
import { logCatchError } from "../lib/log-catch-error";
import type { HeadingEntry } from "../heading-ancestry";
import { measureSync } from "../perf";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import { computeLiveStats } from "../writing-stats";
import { Breadcrumbs } from "./breadcrumbs";
import {
  deriveSidebarSemanticState,
  type SidebarSemanticState,
} from "./sidebar-semantic-state";
import { useSidebarSemanticPublisher } from "./sidebar-semantic-publisher";

interface LexicalEditorPaneProps {
  readonly doc: string;
  readonly docPath?: string;
  readonly revealMode?: RevealMode;
  readonly fs?: FileSystem;
  readonly onDirtyChange?: () => void;
  readonly onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onHeadingsChange?: (headings: HeadingEntry[]) => void;
  readonly onLexicalEditorReady?: (handle: MarkdownEditorHandle | null) => void;
  readonly onSurfaceReady?: () => void;
  readonly projectConfig?: ProjectConfig;
  readonly projectConfigStatus?: ProjectConfigStatus;
}

interface LexicalPaneLiveCounts {
  readonly chars: number;
  readonly words: number;
}

interface LexicalPaneSemanticState extends SidebarSemanticState {
  readonly cacheKey?: string;
  readonly diagnosticStatusKey: string;
  readonly doc: string;
}

interface LexicalSemanticDeriveOptions {
  readonly cacheKey?: string;
  readonly includeDiagnostics: boolean;
  readonly statusDiagnostics?: readonly DiagnosticEntry[];
}

interface LexicalDiagnosticInputs {
  readonly bibliographyPath: string;
  readonly cslPath: string;
  readonly statusDiagnostics: readonly DiagnosticEntry[];
  readonly statusKey: string;
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
    const statusDiagnostics = [...(options.statusDiagnostics ?? [])].sort(compareDiagnostics);
    const diagnostics = options.includeDiagnostics && statusDiagnostics.length > 0
      ? [...nextState.diagnostics, ...statusDiagnostics].sort(compareDiagnostics)
      : nextState.diagnostics;
    const stableDiagnostics = previous?.diagnosticsEnabled
      && sameDiagnosticEntries(previous.diagnostics, diagnostics)
      ? previous.diagnostics
      : diagnostics;

    return {
      cacheKey: options.cacheKey,
      diagnosticStatusKey: diagnosticStatusKey(statusDiagnostics),
      doc,
      ...nextState,
      diagnostics: stableDiagnostics,
    };
  }, { category: "lexical", detail: `${doc.length} chars` });
}

function lexicalDiagnosticInputs(
  doc: string,
  projectConfig: ProjectConfig | undefined,
  projectConfigStatus: ProjectConfigStatus | undefined,
  bibliographyStatus: BibliographyStatus | undefined,
): LexicalDiagnosticInputs {
  const frontmatter = parseFrontmatter(doc);
  const mergedConfig = mergeConfigs(projectConfig ?? {}, frontmatter.config);
  const diagnostics = [
    diagnosticFromFrontmatterStatus(frontmatter.status),
    projectConfigStatus ? diagnosticFromProjectConfigStatus(projectConfigStatus) : null,
    diagnosticFromBibliographyStatus(bibliographyStatus),
  ].filter((diagnostic): diagnostic is DiagnosticEntry => diagnostic !== null);
  diagnostics.sort(compareDiagnostics);
  return {
    bibliographyPath: mergedConfig.bibliography ?? "",
    cslPath: mergedConfig.csl ?? "",
    statusDiagnostics: diagnostics,
    statusKey: diagnosticStatusKey(diagnostics),
  };
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
  revealMode,
  onDiagnosticsChange,
  onDirtyChange,
  onHeadingsChange,
  onLexicalEditorReady,
  onSurfaceReady,
  projectConfig,
  projectConfigStatus,
  ...editorOptions
}: LexicalEditorPaneProps) {
  const bibliographyStatusRef = useRef<BibliographyStatus>({ state: "idle" });
  const bibliographyLoadKeyRef = useRef("");
  const bibliographyLoadGenerationRef = useRef(0);
  const diagnosticInputsForDoc = useCallback((doc: string) =>
    lexicalDiagnosticInputs(
      doc,
      projectConfig,
      projectConfigStatus,
      bibliographyStatusRef.current,
    ), [projectConfig, projectConfigStatus]);
  const [initialSemanticState] = useState(() => deriveLexicalSemanticState(editorOptions.doc, {
    cacheKey: editorOptions.docPath,
    includeDiagnostics: Boolean(onDiagnosticsChange),
    statusDiagnostics: diagnosticInputsForDoc(editorOptions.doc).statusDiagnostics,
  }));
  const semanticStateRef = useRef(initialSemanticState);
  const semanticPublisher = useSidebarSemanticPublisher({
    onDiagnosticsChange,
    onHeadingsChange,
  });
  const previousCallbacksRef = useRef({
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
  const [headings, setHeadings] = useState<HeadingEntry[]>(initialSemanticState.headings);
  const [selection, setSelection] = useState<MarkdownEditorSelection>({
    anchor: 0,
    focus: 0,
    from: 0,
    to: 0,
  });
  const lexicalMode = revealMode ?? REVEAL_MODE.LEXICAL;

  const shouldDeriveDiagnostics = useCallback(
    () => semanticPublisher.hasDiagnosticsSubscriber(),
    [semanticPublisher],
  );

  const getSemanticState = useCallback((doc: string, includeDiagnostics: boolean) => {
    const cached = semanticStateRef.current;
    const diagnosticInputs = diagnosticInputsForDoc(doc);
    if (
      cached.doc === doc
      && cached.cacheKey === editorOptions.docPath
      && cached.diagnosticStatusKey === diagnosticInputs.statusKey
      && cached.diagnosticsEnabled === includeDiagnostics
    ) {
      return cached;
    }
    const nextState = deriveLexicalSemanticState(doc, {
      cacheKey: editorOptions.docPath,
      includeDiagnostics,
      statusDiagnostics: diagnosticInputs.statusDiagnostics,
    }, cached);
    semanticStateRef.current = nextState;
    return nextState;
  }, [diagnosticInputsForDoc, editorOptions.docPath]);

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
    semanticPublisher.publish(semanticState, {
      force,
      publishDiagnostics,
      publishHeadings,
    });
  }, [semanticPublisher]);

  const publishCurrentBibliographyStatus = useCallback(() => {
    if (!semanticPublisher.hasDiagnosticsSubscriber()) {
      return;
    }
    const semanticState = getSemanticState(currentDocRef.current, true);
    publishSemanticState(semanticState, {
      publishHeadings: false,
      updateHeadingState: false,
    });
  }, [getSemanticState, publishSemanticState, semanticPublisher]);

  const syncBibliographyStatus = useCallback((doc: string) => {
    if (!semanticPublisher.hasDiagnosticsSubscriber()) {
      return;
    }
    const { bibliographyPath, cslPath } = diagnosticInputsForDoc(doc);
    const loadKey = `${editorOptions.docPath ?? ""}\u0000${bibliographyPath}\u0000${cslPath}`;
    if (loadKey === bibliographyLoadKeyRef.current) {
      return;
    }
    bibliographyLoadKeyRef.current = loadKey;
    bibliographyLoadGenerationRef.current += 1;
    const generation = bibliographyLoadGenerationRef.current;

    if (!bibliographyPath) {
      bibliographyStatusRef.current = { state: "idle" };
      publishCurrentBibliographyStatus();
      return;
    }

    if (!editorOptions.fs || !editorOptions.docPath) {
      bibliographyStatusRef.current = { state: "idle" };
      publishCurrentBibliographyStatus();
      return;
    }

    bibliographyStatusRef.current = { state: "idle" };
    publishCurrentBibliographyStatus();

    void loadBibliographyData(
      editorOptions.docPath,
      bibliographyPath,
      cslPath,
      editorOptions.fs,
      () => bibliographyLoadGenerationRef.current === generation,
    ).then((data) => {
      if (!data || bibliographyLoadGenerationRef.current !== generation) {
        return;
      }
      bibliographyStatusRef.current = data.status;
      publishCurrentBibliographyStatus();
    }).catch(logCatchError("[lexical] loadBibliographyData failed"));
  }, [
    diagnosticInputsForDoc,
    editorOptions.docPath,
    editorOptions.fs,
    publishCurrentBibliographyStatus,
    semanticPublisher,
  ]);

  const applyImmediateState = useCallback((
    doc: string,
    options: { readonly forcePublish?: boolean } = {},
  ) => {
    syncBibliographyStatus(doc);
    const semanticState = getSemanticState(doc, shouldDeriveDiagnostics());
    syncLiveCounts(doc);
    publishSemanticState(semanticState, { force: options.forcePublish });
  }, [
    getSemanticState,
    publishSemanticState,
    shouldDeriveDiagnostics,
    syncBibliographyStatus,
    syncLiveCounts,
  ]);

  useEffect(() => {
    const previousCallbacks = previousCallbacksRef.current;
    previousCallbacksRef.current = {
      onDiagnosticsChange,
      onHeadingsChange,
    };
    const diagnosticsSubscriberChanged = onDiagnosticsChange !== undefined
      && onDiagnosticsChange !== previousCallbacks.onDiagnosticsChange;
    const headingsSubscriberChanged = onHeadingsChange !== undefined
      && onHeadingsChange !== previousCallbacks.onHeadingsChange;
    if (diagnosticsSubscriberChanged || headingsSubscriberChanged) {
      if (diagnosticsSubscriberChanged) {
        syncBibliographyStatus(currentDocRef.current);
      }
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
    syncBibliographyStatus,
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
      statusDiagnostics: diagnosticInputsForDoc(editorOptions.doc).statusDiagnostics,
    });
    semanticPublisher.resetPublished();
    applyImmediateState(editorOptions.doc, { forcePublish: true });
    useEditorTelemetryStore.getState().setTelemetry({
      doc: editorOptions.doc,
    });
  }, [
    applyImmediateState,
    cancelScheduledDerivedState,
    editorOptions.doc,
    editorOptions.docPath,
    diagnosticInputsForDoc,
    semanticPublisher,
    shouldDeriveDiagnostics,
  ]);

  useEffect(() => {
    return () => {
      cancelScheduledDerivedState();
      bibliographyLoadGenerationRef.current += 1;
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
    syncBibliographyStatus(text);
    scheduleLiveCounts(text, version);
    scheduleSemanticState(text, version);
  }, [scheduleLiveCounts, scheduleSemanticState, syncBibliographyStatus]);

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
