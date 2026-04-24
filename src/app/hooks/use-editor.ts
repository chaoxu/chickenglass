/**
 * useEditor — React hook that bridges React to a CodeMirror 6 editor instance.
 *
 * This is the single entry point between React and CM6. No other React
 * component should import from @codemirror/* directly.
 *
 * Responsibilities:
 * - Mount/destroy the CM6 editor into a container ref
 * - Subscribe to doc changes, cursor position, and frontmatter via updateListener
 * - Debounce word-count computation (300 ms)
 * - Delegate theme sync, debug wiring, and document services to internal hooks
 * - Delegate scroll tracking to useEditorScroll
 * - Keep a single EditorView alive while synchronising external document switches
 */

import { useRef, useEffect, useState, useMemo, type RefObject } from "react";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { Annotation, Compartment, EditorSelection, type Extension, type Text } from "@codemirror/state";

import {
  createEditor,
  EditorPluginManager,
  defaultEditorPlugins,
  frontmatterField,
  type FrontmatterState,
} from "../../editor";
import { programmaticDocumentChangeAnnotation } from "../../editor/programmatic-document-change";
import { bibDataEffect, bibDataField } from "../../state/bib-data";
import { CslProcessor } from "../../citations/csl-processor";
import type { ProjectConfig, ProjectConfigStatus } from "../project-config";
import type { FileSystem } from "../file-manager";
import { computeLiveStats, computeLiveStatsFromText } from "../writing-stats";
import { useEditorScroll } from "./use-editor-scroll";
import { useEditorDebugBridge } from "./use-editor-debug-bridge";
import { useEditorDocumentServices } from "./use-editor-document-services";
import { useEditorThemeSync } from "./use-editor-theme-sync";
import { useLatest } from "./use-latest";
import { measureSync } from "../perf";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import type { EditorDocumentChange } from "../editor-doc-change";
import type { ResolvedTheme } from "../theme-dom";
import { normalizeCmTextString, textMatchesString } from "../codemirror-text";

export type { ResolvedTheme } from "../theme-dom";

const knownProgrammaticDocumentTextAnnotation = Annotation.define<string>();

/** Options accepted by useEditor. */
export interface UseEditorOptions {
  /** Initial/current document content. External replacements are synced into the existing view. */
  doc: string;
  /** Project-level config forwarded to createEditor. */
  projectConfig?: ProjectConfig;
  /** Structured status for project-level config diagnostics. */
  projectConfigStatus?: ProjectConfigStatus;
  /** Resolved theme ("light" | "dark") — triggers themeCompartment.reconfigure. */
  theme?: ResolvedTheme;
  /** Additional CM6 extensions to include (e.g., change listeners from the parent). */
  extensions?: Extension[];
  /** Filesystem used for bibliography loading and image insertion. */
  fs?: FileSystem;
  /** Path of the document being edited. Used to resolve relative bibliography and image paths. */
  docPath?: string;
  /** Called with the user edit spans whenever the document changes. */
  onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  /** Called when an annotated document replacement updates the live editor text. */
  onProgrammaticDocChange?: (doc: string) => void;
  /** Called with the cursor head position (char offset) whenever the selection changes. */
  onCursorChange?: (pos: number) => void;
  /** Called with the parsed frontmatter state whenever it changes. */
  onFrontmatterChange?: (fm: FrontmatterState | undefined) => void;
  /** Called after the current `doc`/`docPath` has been applied to the live EditorView. */
  onDocumentReady?: (view: EditorView, docPath: string | undefined) => void;
  /**
   * External plugin manager. When provided, useEditor uses it instead of
   * creating its own. This allows the caller (e.g., AppInner) to share a
   * single manager across editor recreations and sync it with settings.
   */
  pluginManager?: EditorPluginManager;
}

/** Values returned by useEditor. */
export interface UseEditorReturn {
  /** The live CM6 EditorView, or null when not yet mounted. */
  view: EditorView | null;
  /** Plugin manager for toggling editor features at runtime. */
  pluginManager: EditorPluginManager;
  /** Image saver callback bound to the current document context. */
  imageSaver: ((file: File) => Promise<string>) | null;
}

function collectDocumentChanges(update: ViewUpdate): EditorDocumentChange[] {
  const changes: EditorDocumentChange[] = [];
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({
      from: fromA,
      to: toA,
      insert: inserted.toString(),
    });
  });
  return changes;
}

function clampPosition(pos: number, docLength: number): number {
  return Math.max(0, Math.min(pos, docLength));
}

function preserveSelection(selection: EditorSelection, docLength: number): EditorSelection {
  return EditorSelection.create(
    selection.ranges.map((range) => EditorSelection.range(
      clampPosition(range.anchor, docLength),
      clampPosition(range.head, docLength),
    )),
    selection.mainIndex,
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mount a CM6 editor into `containerRef` and expose reactive state.
 *
 * The editor is mounted once and external document changes are synced into the
 * existing view instead of forcing a cold restart.
 */
export function useEditor(
  containerRef: RefObject<HTMLElement | null>,
  options: UseEditorOptions,
): UseEditorReturn {
  const {
    doc,
    projectConfig,
    projectConfigStatus,
    theme,
    extensions,
    fs,
    docPath,
    onDocChange,
    onProgrammaticDocChange,
    onCursorChange,
    onFrontmatterChange,
    onDocumentReady,
    pluginManager: externalPluginManager,
  } = options;

  const fallbackManager = useMemo(() => {
    const m = new EditorPluginManager();
    defaultEditorPlugins.forEach((p) => m.register(p));
    return m;
  }, []);

  const pluginManager = externalPluginManager ?? fallbackManager;

  const [view, setView] = useState<EditorView | null>(null);
  const documentServices = useEditorDocumentServices({
    fs,
    docPath,
  });
  const debugBridge = useEditorDebugBridge();
  const documentContextCompartmentRef = useRef(new Compartment());
  const lastLoadedDocRef = useRef(doc);
  const lastLoadedPathRef = useRef(docPath);

  // Delegate scroll tracking to useEditorScroll hook.
  const { resetScroll } = useEditorScroll(view);
  useEditorThemeSync(view, theme);

  // Keep refs pointing to the latest value so callbacks inside
  // the mount effect never capture stale closures.
  const onDocChangeRef = useLatest(onDocChange);
  const onProgrammaticDocChangeRef = useLatest(onProgrammaticDocChange);
  const onCursorChangeRef = useLatest(onCursorChange);
  const onFrontmatterChangeRef = useLatest(onFrontmatterChange);
  const onDocumentReadyRef = useLatest(onDocumentReady);
  const handleFrontmatterChangeRef = useLatest(documentServices.handleFrontmatterChange);
  const createDocumentContextExtensionsRef = useLatest(documentServices.createDocumentContextExtensions);
  const initializeViewRef = useLatest(documentServices.initializeView);
  const resetServicesRef = useLatest(documentServices.resetServices);

  function finalizeDocumentSync(
    targetView: EditorView,
    newDoc: string,
    newPath: string | undefined,
    resetViewport: boolean,
  ) {
    if (resetViewport) {
      targetView.scrollDOM.scrollTop = 0;
      resetScroll();
    }
    const telemetry = useEditorTelemetryStore.getState();
    const counts = computeLiveStats(newDoc);
    telemetry.setLiveCounts(counts.words, counts.chars);
    telemetry.setCursorPos(targetView.state.selection.main.head, targetView);
    const fm = targetView.state.field(frontmatterField, false);
    onFrontmatterChangeRef.current?.(fm);
    initializeViewRef.current(targetView, fm);
    lastLoadedDocRef.current = newDoc;
    lastLoadedPathRef.current = newPath;
    onDocumentReadyRef.current?.(targetView, newPath);
  }

  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWordCountDocRef = useRef<Text | null>(null);

  // ── Create / destroy editor once per mount ────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const telemetry = useEditorTelemetryStore.getState();

    // Build the updateListener that drives reactive state.
    const updateListener = EditorView.updateListener.of((update) => {
      const programmaticDocChange = update.transactions.some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation),
      );

      // Cursor changes
      if (update.selectionSet) {
        const pos = update.state.selection.main.head;
        useEditorTelemetryStore.getState().setCursorPos(pos, update.view);
        onCursorChangeRef.current?.(pos);
      }

      if (update.docChanged) {
        if (!programmaticDocChange) {
          onDocChangeRef.current?.(collectDocumentChanges(update));
        } else {
          const annotatedDoc = update.transactions.find((tr) =>
            tr.annotation(knownProgrammaticDocumentTextAnnotation) !== undefined
          )?.annotation(knownProgrammaticDocumentTextAnnotation);
          const docStr = annotatedDoc ?? update.state.doc.toString();
          lastLoadedDocRef.current = docStr;
          onProgrammaticDocChangeRef.current?.(docStr);
        }

        // Debounced word count → Zustand store (no React setState)
        pendingWordCountDocRef.current = update.state.doc;
        if (wordCountTimerRef.current !== null) {
          clearTimeout(wordCountTimerRef.current);
        }
        wordCountTimerRef.current = setTimeout(() => {
          const pendingDoc = pendingWordCountDocRef.current;
          if (!pendingDoc) {
            wordCountTimerRef.current = null;
            return;
          }
          pendingWordCountDocRef.current = null;
          const { words, chars } = computeLiveStatsFromText(pendingDoc);
          useEditorTelemetryStore.getState().setLiveCounts(words, chars);
          wordCountTimerRef.current = null;
        }, 300);
      }

      // Frontmatter — fire on doc change or when field first appears.
      if (
        update.docChanged ||
        update.startState.field(frontmatterField, false) === undefined
      ) {
        const fm = update.state.field(frontmatterField, false);
        onFrontmatterChangeRef.current?.(fm);
        handleFrontmatterChangeRef.current(fm, update.view);
      }
    });
    const extraExtensions = [
      updateListener,
      documentContextCompartmentRef.current.of(
        createDocumentContextExtensionsRef.current(),
      ),
      ...(extensions ?? []),
    ];

    const newView = measureSync("editor.create", () => createEditor({
      parent: container,
      doc,
      projectConfig,
      projectConfigStatus,
      pluginManager,
      extensions: extraExtensions,
    }), { category: "editor" });

    debugBridge.attachDebugView(newView);
    setView(newView);
    finalizeDocumentSync(newView, normalizeCmTextString(doc), docPath, true);

    return () => {
      if (wordCountTimerRef.current !== null) {
        clearTimeout(wordCountTimerRef.current);
        wordCountTimerRef.current = null;
      }
      pendingWordCountDocRef.current = null;
      telemetry.reset();
      resetServicesRef.current();
      debugBridge.clearDebugView(newView);
      newView.destroy();
      setView(null);
    };
  }, [containerRef, debugBridge, extensions, pluginManager, projectConfig, projectConfigStatus, resetScroll]);

  useEffect(() => {
    if (!view) return;
    view.dispatch({
      effects: documentContextCompartmentRef.current.reconfigure(
        createDocumentContextExtensionsRef.current(),
      ),
    });
  }, [documentServices.createDocumentContextExtensions, view]);

  useEffect(() => {
    if (!view) return;

    const pathChanged = docPath !== lastLoadedPathRef.current;
    const rawDocMatchesLastLoaded = doc === lastLoadedDocRef.current;
    const normalizedDoc = rawDocMatchesLastLoaded ? doc : normalizeCmTextString(doc);
    const docMatchesLastLoaded =
      rawDocMatchesLastLoaded || normalizedDoc === lastLoadedDocRef.current;
    // Saving updates the external doc prop to match the already-live CM6 text.
    // Treat that sync as a no-op so cursor and scroll state stay intact.
    const docChangedExternally =
      !docMatchesLastLoaded
      && !textMatchesString(view.state.doc, normalizedDoc);
    if (!pathChanged && !docChangedExternally) {
      return;
    }
    const destructiveActivation = pathChanged && docChangedExternally;

    resetServicesRef.current();

    // Replace only the CSL processor with an empty one so the stale engine
    // from the previous document can't throw during the brief window before
    // the async bibliography reload completes.  The store is kept so that
    // store.has(id) still routes citations correctly (#770).
    const clearBib = bibDataEffect.of({
      store: view.state.field(bibDataField).store,
      cslProcessor: CslProcessor.empty(),
    });

    if (docChangedExternally) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: normalizedDoc,
        },
        selection: destructiveActivation
          ? { anchor: 0 }
          : preserveSelection(view.state.selection, normalizedDoc.length),
        effects: clearBib,
        annotations: [
          programmaticDocumentChangeAnnotation.of(true),
          knownProgrammaticDocumentTextAnnotation.of(normalizedDoc),
        ],
      });
    } else if (pathChanged) {
      view.dispatch({ effects: clearBib });
    }

    finalizeDocumentSync(view, normalizedDoc, docPath, destructiveActivation);
  }, [doc, docPath, resetScroll, view]);

  return {
    view,
    pluginManager,
    imageSaver: documentServices.imageSaverRef.current,
  };
}

// ── Re-exports for hook consumers ─────────────────────────────────────────────
export type { FrontmatterState };
