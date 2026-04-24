import { useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { documentSemanticsField, getDocumentAnalysisSliceRevision } from "../../state/document-analysis";
import { extractDiagnostics } from "../diagnostics";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import {
  createDiagnosticsSidebarChangeChecker,
  createHeadingSidebarMetadata,
  sameHeadingSidebarMetadata,
  type HeadingSidebarMetadata,
} from "./editor-pane-sidebar-tracking";
import {
  useSidebarSemanticPublisher,
  type SidebarSemanticPublisherCallbacks,
} from "./sidebar-semantic-publisher";

type Cm6SemanticPublisherOptions = SidebarSemanticPublisherCallbacks;

interface Cm6SemanticPublisher {
  readonly extensions: readonly Extension[];
  readonly forcePublishCurrent: (view: EditorView | null) => void;
  readonly readHeadings: (view: EditorView | null) => HeadingEntry[];
}

export function useCm6SemanticPublisher({
  onDiagnosticsChange,
  onHeadingsChange,
}: Cm6SemanticPublisherOptions): Cm6SemanticPublisher {
  const semanticPublisher = useSidebarSemanticPublisher({
    onDiagnosticsChange,
    onHeadingsChange,
  });
  const headingFlushHandleRef = useRef<number | null>(null);
  const pendingHeadingStateRef = useRef<EditorState | null>(null);
  const lastPublishedHeadingMetadataRef = useRef<readonly HeadingSidebarMetadata[]>([]);
  const diagnosticsFlushHandleRef = useRef<number | null>(null);
  const pendingDiagnosticsStateRef = useRef<EditorState | null>(null);
  const diagnosticsChanged = useMemo(() => createDiagnosticsSidebarChangeChecker(), []);

  const publishHeadings = useCallback((state: EditorState, force = false) => {
    if (!semanticPublisher.callbacksRef.current.onHeadingsChange) return;
    const headings = extractHeadings(state);
    const nextMetadata = createHeadingSidebarMetadata(headings);
    if (!force && sameHeadingSidebarMetadata(lastPublishedHeadingMetadataRef.current, nextMetadata)) {
      return;
    }
    lastPublishedHeadingMetadataRef.current = nextMetadata;
    semanticPublisher.publish({ headings, diagnostics: [] }, {
      force,
      publishDiagnostics: false,
    });
  }, [semanticPublisher]);

  const publishDiagnostics = useCallback((state: EditorState) => {
    if (!semanticPublisher.callbacksRef.current.onDiagnosticsChange) return;
    semanticPublisher.publish({
      diagnostics: extractDiagnostics(state),
      headings: [],
    }, {
      publishHeadings: false,
    });
  }, [semanticPublisher]);

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
      if (!semanticPublisher.callbacksRef.current.onHeadingsChange) return;
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
  }, [publishHeadings, semanticPublisher]);

  const diagnosticTrackingExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (!semanticPublisher.callbacksRef.current.onDiagnosticsChange) return;
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
  }, [diagnosticsChanged, publishDiagnostics, semanticPublisher]);

  const forcePublishCurrent = useCallback((view: EditorView | null) => {
    if (!view) return;
    if (semanticPublisher.callbacksRef.current.onHeadingsChange) {
      if (headingFlushHandleRef.current !== null) {
        window.clearTimeout(headingFlushHandleRef.current);
        headingFlushHandleRef.current = null;
      }
      pendingHeadingStateRef.current = view.state;
      publishHeadings(view.state, true);
    }
    if (semanticPublisher.callbacksRef.current.onDiagnosticsChange) {
      if (diagnosticsFlushHandleRef.current !== null) {
        window.clearTimeout(diagnosticsFlushHandleRef.current);
        diagnosticsFlushHandleRef.current = null;
      }
      pendingDiagnosticsStateRef.current = view.state;
      publishDiagnostics(view.state);
    }
  }, [publishDiagnostics, publishHeadings, semanticPublisher]);

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
