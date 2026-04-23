import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import type { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEditor } from "../hooks/use-editor";
import type { UseEditorOptions, UseEditorReturn } from "../hooks/use-editor";
import { useEditorStateTracking } from "../hooks/use-editor-state-tracking";
import { useSidenotesAutoCollapse } from "../hooks/use-sidenotes-auto-collapse";
import { useFootnoteTooltip } from "../hooks/use-footnote-tooltip";
import { useLatest } from "../hooks/use-latest";
import { Breadcrumbs } from "./breadcrumbs";
import { SidenoteMargin, type SidenoteInvalidation } from "./sidenote-margin";
import { computeSidenoteInvalidation } from "./sidenote-invalidation";
import {
  createDiagnosticsSidebarChangeChecker,
  createHeadingSidebarMetadata,
  sameHeadingSidebarMetadata,
  type HeadingSidebarMetadata,
} from "./editor-pane-sidebar-tracking";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import {
  documentSemanticsField,
  getDocumentAnalysisSliceRevision,
} from "../../state/document-analysis";
import {
  defaultEditorPlugins,
  EditorPluginManager,
  lineNumbersCompartment,
  setEditorMode,
  tabSizeCompartment,
  tabSizeExtension,
  type EditorMode,
  wordWrapCompartment,
} from "../../editor";
import type { Settings } from "../lib/types";

const EMPTY_SIDENOTE_INVALIDATION: SidenoteInvalidation = {
  revision: 0,
  footnotesChanged: false,
  macrosChanged: false,
  globalLayoutChanged: false,
  layoutChangeFrom: -1,
};
export interface EditorPaneProps extends UseEditorOptions {
  settings: Settings;
  sidenotesCollapsed?: boolean;
  onSidenotesCollapsedChange?: (collapsed: boolean) => void;
  onStateChange?: (state: UseEditorReturn) => void;
  onDocumentReady?: (view: EditorView, docPath: string | undefined) => void;
  /** Called when the document heading list changes (e.g. after async parse completes). */
  onHeadingsChange?: (headings: HeadingEntry[]) => void;
  /** Called when the document diagnostics change. */
  onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  /** Current CM6 mode. */
  editorMode?: EditorMode;
}

function toCm6EditorMode(mode: EditorMode | undefined): EditorMode {
  return mode === "source" ? "source" : "rich";
}

export function EditorPane({
  onStateChange,
  onDocumentReady,
  settings,
  sidenotesCollapsed,
  onSidenotesCollapsedChange,
  onHeadingsChange,
  onDiagnosticsChange,
  editorMode,
  ...editorOptions
}: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pluginManager] = useState(() => {
    const manager = new EditorPluginManager();
    defaultEditorPlugins.forEach((plugin) => manager.register(plugin));
    return manager;
  });
  const [sidenoteInvalidation, setSidenoteInvalidation] = useState<SidenoteInvalidation>(
    EMPTY_SIDENOTE_INVALIDATION,
  );
  const onHeadingsChangeRef = useLatest(onHeadingsChange);
  const onDiagnosticsChangeRef = useLatest(onDiagnosticsChange);
  const sidenotesCollapsedRef = useLatest(sidenotesCollapsed);
  const headingFlushHandleRef = useRef<number | null>(null);
  const pendingHeadingStateRef = useRef<EditorState | null>(null);
  const lastPublishedHeadingMetadataRef = useRef<readonly HeadingSidebarMetadata[]>([]);
  const diagnosticsFlushHandleRef = useRef<number | null>(null);
  const pendingDiagnosticsStateRef = useRef<EditorState | null>(null);
  const diagnosticsChanged = useMemo(() => createDiagnosticsSidebarChangeChecker(), []);

  const publishHeadings = useCallback((state: EditorState, force = false) => {
    const callback = onHeadingsChangeRef.current;
    if (!callback) return;
    const headings = extractHeadings(state);
    const nextMetadata = createHeadingSidebarMetadata(headings);
    if (!force && sameHeadingSidebarMetadata(lastPublishedHeadingMetadataRef.current, nextMetadata)) {
      return;
    }
    lastPublishedHeadingMetadataRef.current = nextMetadata;
    callback(headings);
  }, []);

  const publishDiagnostics = useCallback((state: EditorState) => {
    const callback = onDiagnosticsChangeRef.current;
    if (!callback) return;
    callback(extractDiagnostics(state));
  }, []);

  useEffect(() => {
    return () => {
      if (headingFlushHandleRef.current !== null) {
        window.clearTimeout(headingFlushHandleRef.current);
        headingFlushHandleRef.current = null;
      }
      if (diagnosticsFlushHandleRef.current !== null) {
        window.clearTimeout(diagnosticsFlushHandleRef.current);
        diagnosticsFlushHandleRef.current = null;
      }
    };
  }, []);

  // CM6 extension that detects heading-slice revision changes and
  // pushes fresh headings into React.  Created once (stable reference)
  // so it never triggers editor re-creation.
  const headingTrackingExtension = useMemo(() => {
    let lastRev: number | undefined;
    return EditorView.updateListener.of((update) => {
      if (!onHeadingsChangeRef.current) return;
      const analysis = update.state.field(documentSemanticsField, false);
      if (!analysis) return;
      const rev = getDocumentAnalysisSliceRevision(analysis, "headings");
      if (rev === lastRev) return;
      lastRev = rev;
      pendingHeadingStateRef.current = update.state;
      if (headingFlushHandleRef.current !== null) return;
      headingFlushHandleRef.current = window.setTimeout(() => {
        headingFlushHandleRef.current = null;
        const state = pendingHeadingStateRef.current;
        if (!state) return;
        publishHeadings(state);
      }, 0);
    });
  }, [publishHeadings]);

  // CM6 extension that detects semantic or bibliography changes and
  // pushes fresh diagnostics into React.
  const diagnosticTrackingExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (!onDiagnosticsChangeRef.current) return;
      if (!diagnosticsChanged(update.startState, update.state)) return;
      pendingDiagnosticsStateRef.current = update.state;
      if (diagnosticsFlushHandleRef.current !== null) return;
      diagnosticsFlushHandleRef.current = window.setTimeout(() => {
        diagnosticsFlushHandleRef.current = null;
        const state = pendingDiagnosticsStateRef.current;
        if (!state) return;
        publishDiagnostics(state);
      }, 0);
    });
  }, [diagnosticsChanged, publishDiagnostics]);

  const sidenoteTrackingExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (sidenotesCollapsedRef.current) return;
      const invalidation = computeSidenoteInvalidation(update);
      if (!invalidation) return;

      setSidenoteInvalidation((previous) => ({
        revision: previous.revision + 1,
        ...invalidation,
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
    pluginManager,
  });

  const { view } = editorState;

  useEditorStateTracking(editorState, onStateChange);
  useSidenotesAutoCollapse(view, sidenotesCollapsed, onSidenotesCollapsedChange);
  useFootnoteTooltip(view, sidenotesCollapsed);

  useEffect(() => {
    const activeView = view ?? null;
    for (const { plugin, enabled } of pluginManager.getPlugins()) {
      const settingEnabled = settings.enabledPlugins[plugin.id];
      if (settingEnabled !== undefined && settingEnabled !== enabled) {
        pluginManager.setEnabled(activeView, plugin.id, settingEnabled);
      }
    }
  }, [settings.enabledPlugins, view, pluginManager]);

  useEffect(() => {
    if (!view) return;
    view.dispatch({
      effects: [
        wordWrapCompartment.reconfigure(
          settings.wordWrap ? EditorView.lineWrapping : [],
        ),
        lineNumbersCompartment.reconfigure(
          settings.showLineNumbers ? lineNumbers() : [],
        ),
        tabSizeCompartment.reconfigure(tabSizeExtension(settings.tabSize)),
      ],
    });
  }, [view, settings.wordWrap, settings.showLineNumbers, settings.tabSize]);

  useEffect(() => {
    if (!view) return;
    setEditorMode(view, toCm6EditorMode(editorMode));
  }, [view, editorMode]);

  // When a hidden sidebar panel is shown again, push one fresh snapshot
  // without waiting for the next semantic revision.
  useEffect(() => {
    if (view && onHeadingsChange) {
      if (headingFlushHandleRef.current !== null) {
        window.clearTimeout(headingFlushHandleRef.current);
        headingFlushHandleRef.current = null;
      }
      pendingHeadingStateRef.current = view.state;
      publishHeadings(view.state, true);
    }
  }, [onHeadingsChange, publishHeadings, view]);
  useEffect(() => {
    if (view && onDiagnosticsChange) {
      if (diagnosticsFlushHandleRef.current !== null) {
        window.clearTimeout(diagnosticsFlushHandleRef.current);
        diagnosticsFlushHandleRef.current = null;
      }
      pendingDiagnosticsStateRef.current = view.state;
      publishDiagnostics(view.state);
    }
  }, [onDiagnosticsChange, publishDiagnostics, view]);

  // Extract headings for breadcrumbs and outline
  const headings = view ? extractHeadings(view.state) : [];

  return (
    <div className="flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
      <Breadcrumbs
        headings={headings}
        onSelect={(from) => {
          if (view) {
            view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
            view.focus();
          }
        }}
      />
      <div ref={containerRef} className="h-full" />
      {!sidenotesCollapsed && (
        <SidenoteMargin view={view} invalidation={sidenoteInvalidation} />
      )}
    </div>
  );
}
