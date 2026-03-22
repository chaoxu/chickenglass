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
 * - Destroy the old view and create a new one when the `doc` prop changes
 */

import { useRef, useEffect, useState, useMemo, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { createEditor } from "../../editor/editor";
import { EditorPluginManager } from "../../editor/editor-plugin";
import { defaultEditorPlugins } from "../../editor/editor-plugins-registry";
import { frontmatterField, type FrontmatterState } from "../../editor/frontmatter-state";
import type { ProjectConfig } from "../project-config";
import type { FileSystem } from "../file-manager";
import { computeDocStats } from "../writing-stats";
import { useEditorScroll } from "./use-editor-scroll";
import { useEditorDebugBridge } from "./use-editor-debug-bridge";
import { useEditorDocumentServices } from "./use-editor-document-services";
import { useEditorThemeSync } from "./use-editor-theme-sync";
import { measureSync } from "../perf";

/** Resolved theme for the CM6 dark/light base extension. */
export type ResolvedTheme = "light" | "dark";

/** Options accepted by useEditor. */
export interface UseEditorOptions {
  /** Initial document content. When this changes the editor is recreated. */
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
  /** Called with the full document string whenever it changes. */
  onDocChange?: (doc: string) => void;
  /** Called with the cursor head position (char offset) whenever the selection changes. */
  onCursorChange?: (pos: number) => void;
  /** Called with the parsed frontmatter state whenever it changes. */
  onFrontmatterChange?: (fm: FrontmatterState | undefined) => void;
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
  /** Debounced word count of the current document. */
  wordCount: number;
  /** Current cursor head position (char offset). */
  cursorPos: number;
  /** Current scroll top of the editor scroller (px). */
  scrollTop: number;
  /** Character offset of the first visible line in the viewport. */
  viewportFrom: number;
  /** Plugin manager for toggling editor features at runtime. */
  pluginManager: EditorPluginManager;
  /** Image saver callback bound to the current document context. */
  imageSaver: ((file: File) => Promise<string>) | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mount a CM6 editor into `containerRef` and expose reactive state.
 *
 * The editor is destroyed and recreated whenever the `doc` string changes
 * (same pattern as `switchEditor` in app.ts).
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
    onCursorChange,
    onFrontmatterChange,
    pluginManager: externalPluginManager,
  } = options;

  const fallbackManager = useMemo(() => {
    const m = new EditorPluginManager();
    defaultEditorPlugins.forEach((p) => m.register(p));
    return m;
  }, []);

  const pluginManager = externalPluginManager ?? fallbackManager;

  const [view, setView] = useState<EditorView | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const documentServices = useEditorDocumentServices({ doc, fs, docPath });
  const debugBridge = useEditorDebugBridge();

  // Delegate scroll tracking to useEditorScroll hook.
  const { scrollTop, viewportFrom, resetScroll } = useEditorScroll(view);
  useEditorThemeSync(view, theme);

  // Stable refs so callbacks inside the effect don't capture stale closures.
  const onDocChangeRef = useRef(onDocChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onFrontmatterChangeRef = useRef(onFrontmatterChange);
  const handleFrontmatterChangeRef = useRef(documentServices.handleFrontmatterChange);
  useEffect(() => {
    onDocChangeRef.current = onDocChange;
    onCursorChangeRef.current = onCursorChange;
    onFrontmatterChangeRef.current = onFrontmatterChange;
    handleFrontmatterChangeRef.current = documentServices.handleFrontmatterChange;
  }, [onDocChange, onCursorChange, onFrontmatterChange, documentServices.handleFrontmatterChange]);

  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Create / destroy editor when doc or container changes ─────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Build the updateListener that drives reactive state.
    const updateListener = EditorView.updateListener.of((update) => {
      // Cursor changes
      if (update.selectionSet) {
        const pos = update.state.selection.main.head;
        setCursorPos(pos);
        onCursorChangeRef.current?.(pos);
      }

      if (update.docChanged) {
        const docStr = update.state.doc.toString();
        onDocChangeRef.current?.(docStr);

        // Debounced word count — reuses computeDocStats which already handles
        // frontmatter stripping and proper tokenisation.
        if (wordCountTimerRef.current !== null) {
          clearTimeout(wordCountTimerRef.current);
        }
        wordCountTimerRef.current = setTimeout(() => {
          setWordCount(computeDocStats(docStr).words);
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
    const extraExtensions = documentServices.createExtensions([
      updateListener,
      ...(extensions ?? []),
    ]);

    const newView = measureSync("editor.create", () => createEditor({
      parent: container,
      doc,
      projectConfig,
      pluginManager,
      extensions: extraExtensions,
    }), { category: "editor" });

    debugBridge.attachDebugView(newView);
    setView(newView);
    setWordCount(computeDocStats(doc).words);
    setCursorPos(0);
    resetScroll();

    // Initial frontmatter notification
    const initialFm = newView.state.field(frontmatterField, false);
    onFrontmatterChangeRef.current?.(initialFm);
    documentServices.initializeView(newView, initialFm);

    return () => {
      if (wordCountTimerRef.current !== null) {
        clearTimeout(wordCountTimerRef.current);
        wordCountTimerRef.current = null;
      }
      documentServices.resetServices();
      debugBridge.clearDebugView(newView);
      newView.destroy();
      setView(null);
    };
    // Doc changes intentionally recreate the editor (same as switchEditor).
  }, [doc, containerRef]);

  return {
    view,
    wordCount,
    cursorPos,
    scrollTop,
    viewportFrom,
    pluginManager,
    imageSaver: documentServices.imageSaverRef.current,
  };
}

// ── Re-exports for hook consumers ─────────────────────────────────────────────
export type { FrontmatterState };
