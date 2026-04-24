import { useCallback, useMemo } from "react";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { documentSemanticsField, getDocumentAnalysisSliceRevision } from "../../state/document-analysis";
import { extractDiagnostics } from "../diagnostics";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import {
  createHeadingSidebarMetadata,
  diagnosticsSidebarMetadataKey,
  sameHeadingSidebarMetadata,
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

  const sameVisibleHeadings = useCallback((
    before: readonly HeadingEntry[],
    after: readonly HeadingEntry[],
  ) => sameHeadingSidebarMetadata(
    createHeadingSidebarMetadata(before),
    createHeadingSidebarMetadata(after),
  ), []);

  const headingTrackingExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (!semanticPublisher.callbacksRef.current.onHeadingsChange) return;
      const analysis = update.state.field(documentSemanticsField, false);
      if (!analysis) return;
      const rev = getDocumentAnalysisSliceRevision(analysis, "headings");
      semanticPublisher.queueHeadings({
        derive: () => extractHeadings(update.state),
        revisionKey: rev,
        sameHeadings: sameVisibleHeadings,
      });
    });
  }, [sameVisibleHeadings, semanticPublisher]);

  const diagnosticTrackingExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (!semanticPublisher.callbacksRef.current.onDiagnosticsChange) return;
      semanticPublisher.queueDiagnostics({
        derive: () => extractDiagnostics(update.state),
        revisionKey: diagnosticsSidebarMetadataKey(update.state),
      });
    });
  }, [semanticPublisher]);

  const forcePublishCurrent = useCallback((view: EditorView | null) => {
    if (!view) return;
    if (semanticPublisher.callbacksRef.current.onHeadingsChange) {
      semanticPublisher.flushHeadings({
        derive: () => extractHeadings(view.state),
        force: true,
        revisionKey: getDocumentAnalysisSliceRevision(
          view.state.field(documentSemanticsField),
          "headings",
        ),
        sameHeadings: sameVisibleHeadings,
      });
    }
    if (semanticPublisher.callbacksRef.current.onDiagnosticsChange) {
      semanticPublisher.flushDiagnostics({
        derive: () => extractDiagnostics(view.state),
        force: true,
        revisionKey: diagnosticsSidebarMetadataKey(view.state),
      });
    }
  }, [sameVisibleHeadings, semanticPublisher]);

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
