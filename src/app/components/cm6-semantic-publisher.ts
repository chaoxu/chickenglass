import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { documentSemanticsField, getDocumentAnalysisSliceRevision } from "../../state/document-analysis";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import {
  createDiagnosticsSidebarChangeChecker,
  createHeadingSidebarMetadata,
  sameHeadingSidebarMetadata,
  type HeadingSidebarMetadata,
} from "./editor-pane-sidebar-tracking";

interface Cm6SemanticPublisherOptions {
  readonly onDiagnosticsChange?: (diagnostics: DiagnosticEntry[]) => void;
  readonly onHeadingsChange?: (headings: HeadingEntry[]) => void;
}

interface Cm6SemanticPublisher {
  readonly extensions: readonly Extension[];
  readonly forcePublishCurrent: (view: EditorView | null) => void;
  readonly readHeadings: (view: EditorView | null) => HeadingEntry[];
}

export function useCm6SemanticPublisher({
  onDiagnosticsChange,
  onHeadingsChange,
}: Cm6SemanticPublisherOptions): Cm6SemanticPublisher {
  const onHeadingsChangeRef = useRef(onHeadingsChange);
  const onDiagnosticsChangeRef = useRef(onDiagnosticsChange);
  const headingFlushHandleRef = useRef<number | null>(null);
  const pendingHeadingStateRef = useRef<EditorState | null>(null);
  const lastPublishedHeadingMetadataRef = useRef<readonly HeadingSidebarMetadata[]>([]);
  const diagnosticsFlushHandleRef = useRef<number | null>(null);
  const pendingDiagnosticsStateRef = useRef<EditorState | null>(null);
  const diagnosticsChanged = useMemo(() => createDiagnosticsSidebarChangeChecker(), []);

  useEffect(() => {
    onHeadingsChangeRef.current = onHeadingsChange;
  }, [onHeadingsChange]);

  useEffect(() => {
    onDiagnosticsChangeRef.current = onDiagnosticsChange;
  }, [onDiagnosticsChange]);

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

  const forcePublishCurrent = useCallback((view: EditorView | null) => {
    if (!view) return;
    if (onHeadingsChangeRef.current) {
      if (headingFlushHandleRef.current !== null) {
        window.clearTimeout(headingFlushHandleRef.current);
        headingFlushHandleRef.current = null;
      }
      pendingHeadingStateRef.current = view.state;
      publishHeadings(view.state, true);
    }
    if (onDiagnosticsChangeRef.current) {
      if (diagnosticsFlushHandleRef.current !== null) {
        window.clearTimeout(diagnosticsFlushHandleRef.current);
        diagnosticsFlushHandleRef.current = null;
      }
      pendingDiagnosticsStateRef.current = view.state;
      publishDiagnostics(view.state);
    }
  }, [publishDiagnostics, publishHeadings]);

  const readHeadings = useCallback((view: EditorView | null): HeadingEntry[] => {
    return view ? extractHeadings(view.state) : [];
  }, []);

  const extensions = useMemo(
    () => [headingTrackingExtension, diagnosticTrackingExtension],
    [diagnosticTrackingExtension, headingTrackingExtension],
  );

  return useMemo(() => ({
    extensions,
    forcePublishCurrent,
    readHeadings,
  }), [extensions, forcePublishCurrent, readHeadings]);
}
