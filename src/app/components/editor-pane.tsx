import { useRef, useMemo, useState, useEffect } from "react";
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
import { type HeadingEntry } from "../heading-ancestry";
import { type DiagnosticEntry } from "../diagnostics";
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
import { useCm6SemanticPublisher } from "./cm6-semantic-publisher";

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
  const sidenotesCollapsedRef = useLatest(sidenotesCollapsed);
  const semanticPublisher = useCm6SemanticPublisher({
    onDiagnosticsChange,
    onHeadingsChange,
  });

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
      ...semanticPublisher.extensions,
      sidenoteTrackingExtension,
    ],
    [editorOptions.extensions, semanticPublisher.extensions, sidenoteTrackingExtension],
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
    setEditorMode(view, editorMode ?? "rich");
  }, [view, editorMode]);

  // When a hidden sidebar panel is shown again, push one fresh snapshot
  // without waiting for the next semantic revision.
  useEffect(() => {
    semanticPublisher.forcePublishCurrent(view ?? null);
  }, [onDiagnosticsChange, onHeadingsChange, semanticPublisher, view]);

  // Extract headings for breadcrumbs and outline
  const headings = semanticPublisher.readHeadings(view ?? null);

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
