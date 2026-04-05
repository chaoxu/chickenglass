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
import { Compartment, type Extension } from "@codemirror/state";

import {
  createEditor,
  EditorPluginManager,
  defaultEditorPlugins,
  frontmatterField,
  type FrontmatterState,
} from "../../editor";
import { programmaticDocumentChangeAnnotation } from "../../editor/programmatic-document-change";
import { setIncludeRegionsEffect } from "../../lib/include-regions";
import { bibDataEffect, bibDataField } from "../../citations/citation-render";
import { CslProcessor } from "../../citations/csl-processor";
import type { ProjectConfig } from "../project-config";
import type { FileSystem } from "../file-manager";
import { computeLiveStats } from "../writing-stats";
import { useEditorScroll } from "./use-editor-scroll";
import { useEditorDebugBridge } from "./use-editor-debug-bridge";
import { useEditorDocumentServices } from "./use-editor-document-services";
import { useEditorThemeSync } from "./use-editor-theme-sync";
import { measureSync } from "../perf";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";
import type { SourceMap } from "../source-map";
import type { EditorDocumentChange } from "../editor-doc-change";

/** Resolved theme for the CM6 dark/light base extension. */
export type ResolvedTheme = "light" | "dark";

/** Options accepted by useEditor. */
export interface UseEditorOptions {
  /** Initial/current document content. External replacements are synced into the existing view. */
  doc: string;
  /** Project-level config forwarded to createEditor. */
  projectConfig?: ProjectConfig;
  /** Resolved theme ("light" | "dark") — triggers themeCompartment.reconfigure. */
  theme?: ResolvedTheme;
  /** Additional CM6 extensions to include (e.g., change listeners from the parent). */
  extensions?: Extension[];
  /**
   * Filesystem used for bibliography and include loading.
   * When omitted, bibliography loading and include expansion are skipped.
   */
  fs?: FileSystem;
  /**
   * Path of the document being edited.
   * Used to resolve relative bibliography and include paths.
   */
  docPath?: string;
  /** Called with the user edit spans whenever the document changes. */
  onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  /** Called when an annotated document replacement updates the live editor text. */
  onProgrammaticDocChange?: (doc: string) => void;
  /** Called with the cursor head position (char offset) whenever the selection changes. */
  onCursorChange?: (pos: number) => void;
  /** Called with the parsed frontmatter state whenever it changes. */
  onFrontmatterChange?: (fm: FrontmatterState | undefined) => void;
  /** Called when include expansion installs or clears a source map for the active document. */
  onSourceMapChange?: (sourceMap: SourceMap | null) => void;
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

/** Keep a ref always pointing to the latest value of `value`. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
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
    theme,
    extensions,
    fs,
    docPath,
    onDocChange,
    onProgrammaticDocChange,
    onCursorChange,
    onFrontmatterChange,
    onSourceMapChange,
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
    doc,
    fs,
    docPath,
    onSourceMapChange,
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

  /**
   * Shared "document became current" lifecycle used by both initial mount
   * and external document switches. Resets scroll/telemetry, fires frontmatter
   * and readiness callbacks, and records the loaded doc identity.
   */
  function applyDocumentReady(targetView: EditorView, newDoc: string, newPath: string | undefined) {
    targetView.scrollDOM.scrollTop = 0;
    resetScroll();
    const telemetry = useEditorTelemetryStore.getState();
    const counts = computeLiveStats(newDoc);
    telemetry.setLiveCounts(counts.words, counts.chars);
    telemetry.setCursorPos(0, targetView);
    const fm = targetView.state.field(frontmatterField, false);
    onFrontmatterChangeRef.current?.(fm);
    initializeViewRef.current(targetView, fm, newDoc);
    lastLoadedDocRef.current = newDoc;
    lastLoadedPathRef.current = newPath;
    onDocumentReadyRef.current?.(targetView, newPath);
  }

  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          window.__cfSourceMap?.mapThrough(update.changes);
          onDocChangeRef.current?.(collectDocumentChanges(update));
        } else {
          const docStr = update.state.doc.toString();
          lastLoadedDocRef.current = docStr;
          onProgrammaticDocChangeRef.current?.(docStr);
        }

        // Debounced word count → Zustand store (no React setState)
        if (wordCountTimerRef.current !== null) {
          clearTimeout(wordCountTimerRef.current);
        }
        wordCountTimerRef.current = setTimeout(() => {
          const docStr = update.state.doc.toString();
          const { words, chars } = computeLiveStats(docStr);
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
      pluginManager,
      extensions: extraExtensions,
    }), { category: "editor" });

    debugBridge.attachDebugView(newView);
    setView(newView);
    applyDocumentReady(newView, doc, docPath);

    return () => {
      if (wordCountTimerRef.current !== null) {
        clearTimeout(wordCountTimerRef.current);
        wordCountTimerRef.current = null;
      }
      telemetry.reset();
      resetServicesRef.current();
      debugBridge.clearDebugView(newView);
      newView.destroy();
      setView(null);
    };
  }, [containerRef, debugBridge, extensions, pluginManager, projectConfig, resetScroll]);

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
    const docMatchesLastLoaded = doc === lastLoadedDocRef.current;
    // Saving updates the external doc prop to match the already-live CM6 text.
    // Treat that sync as a no-op so cursor and scroll state stay intact.
    const docChangedExternally =
      !docMatchesLastLoaded
      && doc !== view.state.doc.toString();
    if (!pathChanged && !docChangedExternally) {
      return;
    }

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
          insert: doc,
        },
        selection: { anchor: 0 },
        effects: [setIncludeRegionsEffect.of([]), clearBib],
        annotations: programmaticDocumentChangeAnnotation.of(true),
      });
    } else if (pathChanged) {
      view.dispatch({ selection: { anchor: 0 }, effects: clearBib });
    }

    applyDocumentReady(view, doc, docPath);
  }, [doc, docPath, resetScroll, view]);

  return {
    view,
    pluginManager,
    imageSaver: documentServices.imageSaverRef.current,
  };
}

// ── Re-exports for hook consumers ─────────────────────────────────────────────
export type { FrontmatterState };
