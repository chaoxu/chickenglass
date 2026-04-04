import { useRef, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { EditorView } from "@codemirror/view";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";
import { useEditorStateTracking } from "../hooks/use-editor-state-tracking";
import { useSidenotesAutoCollapse } from "../hooks/use-sidenotes-auto-collapse";
import { useFootnoteTooltip } from "../hooks/use-footnote-tooltip";
import { Breadcrumbs } from "./breadcrumbs";
import { SidenoteMargin } from "./sidenote-margin";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import { blockCounterField } from "../../plugins/block-counter";
import {
  documentSemanticsField,
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
} from "../../semantics/codemirror-source";
import { bibDataField } from "../../citations/citation-render";
import { frontmatterField, type EditorMode } from "../../editor";
import { mathMacrosField } from "../../render";
import { serializeMacros } from "../../render/render-core";

/** Lazy-loaded read-mode view — kept out of the startup bundle (read mode is deferred). */
const ReadModeView = lazy(() =>
  import("./read-mode-view").then((m) => ({ default: m.ReadModeView })),
);

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
}

export function EditorPane({
  onStateChange,
  onDocumentReady,
  sidenotesCollapsed,
  onSidenotesCollapsedChange,
  onHeadingsChange,
  onDiagnosticsChange,
  editorMode,
  ...editorOptions
}: EditorPaneProps) {
  const isReadMode = editorMode === "read";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sidenoteRevision, setSidenoteRevision] = useState(0);

  // Stable ref so the CM6 listener always sees the latest callback
  // without forcing an editor re-creation.
  const onHeadingsChangeRef = useRef(onHeadingsChange);
  useEffect(() => { onHeadingsChangeRef.current = onHeadingsChange; }, [onHeadingsChange]);

  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  useEffect(() => { onDiagnosticsChangeRef.current = onDiagnosticsChange; }, [onDiagnosticsChange]);

  const sidenotesCollapsedRef = useRef(sidenotesCollapsed);
  useEffect(() => { sidenotesCollapsedRef.current = sidenotesCollapsed; }, [sidenotesCollapsed]);

  const isReadModeRef = useRef(isReadMode);
  useEffect(() => { isReadModeRef.current = isReadMode; }, [isReadMode]);

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
    let lastFootnoteRev: number | undefined;
    let lastMacrosKey: string | undefined;

    return EditorView.updateListener.of((update) => {
      if (isReadModeRef.current || sidenotesCollapsedRef.current) return;

      const analysis = update.state.field(documentSemanticsField, false);
      if (!analysis) return;

      const footnoteRev = getDocumentAnalysisSliceRevision(analysis, "footnotes");
      const macros = update.state.field(mathMacrosField, false) ?? {};
      const macrosKey = serializeMacros(macros);
      const footnotesChanged = footnoteRev !== lastFootnoteRev;
      const macrosChanged = macrosKey !== lastMacrosKey;

      lastFootnoteRev = footnoteRev;
      lastMacrosKey = macrosKey;

      if (!footnotesChanged && !macrosChanged && !update.geometryChanged) return;
      setSidenoteRevision((value) => value + 1);
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

  // Get the live document content, frontmatter config, and bibliography for ReadModeView
  const readModeContent = view ? view.state.doc.toString() : editorOptions.doc;
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
      {!isReadMode && !sidenotesCollapsed && <SidenoteMargin view={view} revision={sidenoteRevision} />}
    </div>
  );
}
