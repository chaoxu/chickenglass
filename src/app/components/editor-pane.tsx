import { useRef, useMemo, useState, lazy, Suspense, useSyncExternalStore, useCallback } from "react";
import { EditorView } from "@codemirror/view";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";
import { useEditorStateTracking } from "../hooks/use-editor-state-tracking";
import { useSidenotesAutoCollapse } from "../hooks/use-sidenotes-auto-collapse";
import { useFootnoteTooltip } from "../hooks/use-footnote-tooltip";
import { useLatest } from "../hooks/use-latest";
import { Breadcrumbs } from "./breadcrumbs";
import { SidenoteMargin, type SidenoteInvalidation } from "./sidenote-margin";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import {
  documentSemanticsField,
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
} from "../../semantics/codemirror-source";
import { blockCounterField } from "../../state/block-counter";
import { bibDataField } from "../../citations/citation-render";
import { frontmatterField, type EditorMode } from "../../editor";
import { mathMacrosField } from "../../render";
import { serializeMacros } from "../../render/render-core";
import {
  EMPTY_ACTIVE_DOCUMENT_SNAPSHOT,
  unsubscribeNoop,
  type ActiveDocumentSignal,
} from "../active-document-signal";

/** Lazy-loaded read-mode view — kept out of the startup bundle (read mode is deferred). */
const ReadModeView = lazy(() =>
  import("./read-mode-view").then((m) => ({ default: m.ReadModeView })),
);

const EMPTY_MACROS: Record<string, string> = {};
const EMPTY_SIDENOTE_INVALIDATION: SidenoteInvalidation = {
  revision: 0,
  footnotesChanged: false,
  macrosChanged: false,
  globalLayoutChanged: false,
  layoutChangeFrom: -1,
};
export interface EditorPaneProps extends UseEditorOptions {
  sidenotesCollapsed?: boolean;
  onSidenotesCollapsedChange?: (collapsed: boolean) => void;
  onStateChange?: (state: UseEditorReturn) => void;
  onDocumentReady?: (view: EditorView, docPath: string | undefined) => void;
  /** Called when the document heading list changes (e.g. after async parse completes). */
  onHeadingsChange?: (headings: HeadingEntry[]) => void;
  /** Called when the document diagnostics change. */
  onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  /** Current editor mode — "read" shows the HTML renderer instead of CM6. */
  editorMode?: EditorMode;
  /** External signal used to refresh read mode without rerendering the shell. */
  activeDocumentSignal?: ActiveDocumentSignal;
}

export function EditorPane({
  onStateChange,
  onDocumentReady,
  sidenotesCollapsed,
  onSidenotesCollapsedChange,
  onHeadingsChange,
  onDiagnosticsChange,
  editorMode,
  activeDocumentSignal,
  ...editorOptions
}: EditorPaneProps) {
  const isReadMode = editorMode === "read";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sidenoteInvalidation, setSidenoteInvalidation] = useState<SidenoteInvalidation>(
    EMPTY_SIDENOTE_INVALIDATION,
  );
  const onHeadingsChangeRef = useLatest(onHeadingsChange);
  const onDiagnosticsChangeRef = useLatest(onDiagnosticsChange);
  const sidenotesCollapsedRef = useLatest(sidenotesCollapsed);
  const isReadModeRef = useLatest(isReadMode);

  // CM6 extension that detects heading-slice revision changes and
  // pushes fresh headings into React.  Created once (stable reference)
  // so it never triggers editor re-creation.
  const headingTrackingExtension = useMemo(() => {
    let lastRev: number | undefined;
    return EditorView.updateListener.of((update) => {
      const analysis = update.state.field(documentSemanticsField, false);
      if (!analysis) return;
      const rev = getDocumentAnalysisSliceRevision(analysis, "headings");
      if (rev === lastRev) return;
      lastRev = rev;
      onHeadingsChangeRef.current?.(extractHeadings(update.state));
    });
  }, []);

  // CM6 extension that detects semantic or bibliography changes and
  // pushes fresh diagnostics into React.
  const diagnosticTrackingExtension = useMemo(() => {
    let lastAnalysisRev: number | undefined;
    let lastBibRev: number | undefined;
    return EditorView.updateListener.of((update) => {
      const analysis = update.state.field(documentSemanticsField, false);
      if (!analysis) return;
      const analysisRev = getDocumentAnalysisRevision(analysis);
      const bibState = update.state.field(bibDataField, false);
      const bibRev = bibState?.processorRevision;
      const blockCountersChanged =
        update.startState.field(blockCounterField, false)
        !== update.state.field(blockCounterField, false);
      if (analysisRev === lastAnalysisRev && bibRev === lastBibRev && !blockCountersChanged) return;
      lastAnalysisRev = analysisRev;
      lastBibRev = bibRev;
      onDiagnosticsChangeRef.current?.(extractDiagnostics(update.state));
    });
  }, []);

  const sidenoteTrackingExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (isReadModeRef.current || sidenotesCollapsedRef.current) return;

      const beforeAnalysis = update.startState.field(documentSemanticsField, false);
      const afterAnalysis = update.state.field(documentSemanticsField, false);
      if (!afterAnalysis) return;

      const footnotesChanged = beforeAnalysis?.footnotes !== afterAnalysis.footnotes;
      const beforeMacros = update.startState.field(mathMacrosField, false) ?? EMPTY_MACROS;
      const afterMacros = update.state.field(mathMacrosField, false) ?? EMPTY_MACROS;
      const macrosChanged = beforeMacros !== afterMacros
        && serializeMacros(beforeMacros) !== serializeMacros(afterMacros);
      let layoutChangeFrom = -1;
      if (update.docChanged) {
        update.changes.iterChangedRanges((_fromA, _toA, fromB) => {
          if (layoutChangeFrom === -1 || fromB < layoutChangeFrom) {
            layoutChangeFrom = fromB;
          }
        });
      }
      const globalLayoutChanged = !update.docChanged && update.heightChanged;

      if (!footnotesChanged && !macrosChanged && layoutChangeFrom === -1 && !globalLayoutChanged) return;

      setSidenoteInvalidation((previous) => ({
        revision: previous.revision + 1,
        footnotesChanged,
        macrosChanged,
        globalLayoutChanged,
        layoutChangeFrom,
      }));
    });
  }, []);

  const extensions = useMemo(
    () => [
      ...(editorOptions.extensions ?? []),
      headingTrackingExtension,
      diagnosticTrackingExtension,
      sidenoteTrackingExtension,
    ],
    [editorOptions.extensions, headingTrackingExtension, diagnosticTrackingExtension, sidenoteTrackingExtension],
  );

  const editorState = useEditor(containerRef, {
    ...editorOptions,
    onDocumentReady,
    extensions,
  });

  const { view } = editorState;

  useEditorStateTracking(editorState, onStateChange);
  useSidenotesAutoCollapse(view, sidenotesCollapsed, onSidenotesCollapsedChange);
  useFootnoteTooltip(view, sidenotesCollapsed);

  // Extract headings for breadcrumbs and outline
  const headings = view ? extractHeadings(view.state) : [];
  const subscribeToActiveDocument = useCallback((onStoreChange: () => void) => {
    if (!isReadMode || !activeDocumentSignal) {
      return unsubscribeNoop;
    }
    return activeDocumentSignal.subscribe(onStoreChange);
  }, [activeDocumentSignal, isReadMode]);
  const getActiveDocumentSnapshot = useCallback(() => {
    if (!isReadMode || !activeDocumentSignal) {
      return EMPTY_ACTIVE_DOCUMENT_SNAPSHOT;
    }
    return activeDocumentSignal.getSnapshot();
  }, [activeDocumentSignal, isReadMode]);
  const activeDocument = useSyncExternalStore(
    subscribeToActiveDocument,
    getActiveDocumentSnapshot,
    getActiveDocumentSnapshot,
  );

  // Get the live document content, frontmatter config, and bibliography for ReadModeView
  const readModeContent = useMemo(() => {
    if (!isReadMode) {
      return editorOptions.doc;
    }
    // Only read mode subscribes to active-document edits so rich/source typing
    // does not pull the editor pane through a React rerender.
    return view ? view.state.doc.toString() : editorOptions.doc;
  }, [activeDocument.revision, editorOptions.doc, isReadMode, view]);
  const fmState = view ? view.state.field(frontmatterField, false) : undefined;
  const frontmatterConfig = fmState?.config ?? {};
  const bibData = view ? view.state.field(bibDataField, false) : undefined;

  return (
    <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
      {!isReadMode && (
        <Breadcrumbs
          headings={headings}
          onSelect={(from) => {
            if (view) {
              view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
              view.focus();
            }
          }}
        />
      )}
      {/* CM6 editor — hidden (not unmounted) in read mode to preserve state */}
      <div ref={containerRef} className="h-full" style={isReadMode ? { display: "none" } : undefined} />
      {/* Read mode HTML renderer (lazy-loaded — read mode is deferred) */}
      {isReadMode && (
        <Suspense fallback={null}>
          <ReadModeView
            content={readModeContent}
            frontmatterConfig={frontmatterConfig}
            bibliography={bibData?.store}
            cslProcessor={bibData?.cslProcessor}
            fs={editorOptions.fs}
            docPath={editorOptions.docPath}
          />
        </Suspense>
      )}
      {/* Portal target — SidenoteMargin renders into the CM6 scroller via DOM portal */}
      {!isReadMode && !sidenotesCollapsed && (
        <SidenoteMargin view={view} invalidation={sidenoteInvalidation} />
      )}
    </div>
  );
}
