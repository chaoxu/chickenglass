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
 * - Reconfigure the dark/light base theme when `theme` prop changes
 * - Delegate bibliography loading to useBibliography
 * - Delegate scroll tracking to useEditorScroll
 * - Expand ::: {.include} fenced divs using the shared include-resolver utilities
 * - Destroy the old view and create a new one when the `doc` prop changes
 */

import { useRef, useEffect, useState, useMemo, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { createEditor, themeCompartment } from "../../editor/editor";
import { createDebugHelpers, type DebugHelpers } from "../../editor/debug-helpers";
import { EditorPluginManager } from "../../editor/editor-plugin";
import { defaultEditorPlugins } from "../../editor/editor-plugins-registry";
import { chickenglassDarkTheme } from "../../editor/theme";
import { frontmatterField, type FrontmatterState } from "../../editor/frontmatter-state";
import { imagePasteExtension } from "../../editor/image-paste";
import { imageDropExtension } from "../../editor/image-drop";
import { createImageSaver, type ImageSaveContext } from "../../editor/image-save";
import type { ProjectConfig } from "../project-config";
import type { FileSystem } from "../file-manager";
import { computeDocStats } from "../writing-stats";
import {
  extractIncludePaths,
  resolveIncludePath,
  flattenIncludesWithSourceMap,
  type ResolvedInclude,
} from "../../plugins/include-resolver";
import type { IncludeRegion } from "../source-map";
import { useBibliography } from "./use-bibliography";
import { useEditorScroll } from "./use-editor-scroll";

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape of debug globals attached to `window` for console/Playwright access. */
interface DebugWindow {
  __cmView?: EditorView;
  __cmDebug?: DebugHelpers;
}

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

// ── Include expansion (uses shared include-resolver utilities) ───────────────

/**
 * Expand one level of include blocks in `content`.
 * Uses the shared extractIncludePaths / resolveIncludePath / flattenIncludesWithSourceMap
 * utilities from plugins/include-resolver — no duplicated regex logic.
 *
 * Returns the expanded text and include regions for the source map.
 */
async function expandIncludes(
  mainPath: string,
  rawContent: string,
  fs: FileSystem,
): Promise<{ text: string; regions: IncludeRegion[] }> {
  const paths = extractIncludePaths(rawContent);
  if (paths.length === 0) return { text: rawContent, regions: [] };

  const includes: ResolvedInclude[] = [];
  for (const rawPath of paths) {
    const resolved = resolveIncludePath(mainPath, rawPath);
    let content: string;
    try {
      content = await fs.readFile(resolved);
    } catch {
      // Included file not found or unreadable — skip expansion, return raw content
      return { text: rawContent, regions: [] };
    }
    includes.push({ path: resolved, content, children: [] });
  }

  const result = flattenIncludesWithSourceMap(rawContent, includes);
  return {
    text: result.text,
    regions: result.regions.map((r) => ({
      from: r.from,
      to: r.to,
      file: r.file,
      originalRef: r.originalRef,
      rawFrom: r.rawFrom,
      rawTo: r.rawTo,
    })),
  };
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
  const imageSaverRef = useRef<((file: File) => Promise<string>) | null>(null);

  // Delegate bibliography loading to useBibliography hook.
  const bib = useBibliography({ fs, docPath });

  // Delegate scroll tracking to useEditorScroll hook.
  const { scrollTop, viewportFrom, resetScroll } = useEditorScroll(view);

  // Stable refs so callbacks inside the effect don't capture stale closures.
  const onDocChangeRef = useRef(onDocChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onFrontmatterChangeRef = useRef(onFrontmatterChange);
  useEffect(() => { onDocChangeRef.current = onDocChange; }, [onDocChange]);
  useEffect(() => { onCursorChangeRef.current = onCursorChange; }, [onCursorChange]);
  useEffect(() => { onFrontmatterChangeRef.current = onFrontmatterChange; }, [onFrontmatterChange]);

  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref for bib.handleBibChange to avoid stale closures in the effect.
  const handleBibChangeRef = useRef(bib.handleBibChange);
  useEffect(() => { handleBibChangeRef.current = bib.handleBibChange; }, [bib.handleBibChange]);

  // ── Create / destroy editor when doc or container changes ─────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Reset bibliography tracking on new editor.
    bib.resetTracking();

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

        // Bibliography loading — delegated to useBibliography.
        const bibPath = fm?.config.bibliography ?? "";
        const cslPath = fm?.config.csl ?? "";
        handleBibChangeRef.current(bibPath, cslPath, update.view);
      }
    });

    // Image save context — reads imageFolder from frontmatter dynamically.
    // We create a mutable ref so the save callback always reads the latest
    // frontmatter config even though the extension is created once.
    let currentImageFolder: string | undefined;
    const imageSaveCtx: ImageSaveContext = {
      fs,
      docPath,
      get imageFolder() {
        return currentImageFolder;
      },
    };
    const imageSaver = createImageSaver(imageSaveCtx);

    // Wrap the updateListener to also track imageFolder changes
    const imageAwareUpdateListener = EditorView.updateListener.of((update) => {
      // Keep imageFolder in sync with frontmatter
      const fm = update.state.field(frontmatterField, false);
      currentImageFolder = fm?.config.imageFolder;
    });

    const extraExtensions: Extension[] = [
      updateListener,
      imageAwareUpdateListener,
      imagePasteExtension({ saveImage: imageSaver }),
      imageDropExtension({ saveImage: imageSaver }),
      ...(extensions ?? []),
    ];

    const newView = createEditor({
      parent: container,
      doc,
      projectConfig,
      pluginManager,
      extensions: extraExtensions,
    });

    // Expose view and debug helpers for console/Playwright debugging.
    const w = window as unknown as DebugWindow;
    w.__cmView = newView;
    w.__cmDebug = createDebugHelpers(newView);

    // Store imageSaver ref so commands can access it
    imageSaverRef.current = imageSaver;

    setView(newView);
    setWordCount(computeDocStats(doc).words);
    setCursorPos(0);
    resetScroll();

    // Initial frontmatter notification
    const initialFm = newView.state.field(frontmatterField, false);
    onFrontmatterChangeRef.current?.(initialFm);

    // Initial bibliography load — delegated to useBibliography.
    const initialBibPath = initialFm?.config.bibliography ?? "";
    const initialCslPath = initialFm?.config.csl ?? "";
    bib.loadInitial(initialBibPath, initialCslPath, newView);

    // Include expansion: patch the document in-place after mount if needed.
    // expandIncludes returns early with the same string when no includes are found.
    if (fs && docPath) {
      void expandIncludes(docPath, doc, fs).then(({ text: expanded, regions }) => {
        if (expanded === doc) return; // no includes — no-op
        if (newView.dom.isConnected) {
          // Set global source map BEFORE dispatch so the include-label plugin
          // picks it up during the docChanged StateField update
          if (regions.length > 0) {
            (window as unknown as { __cgSourceMap?: { regions: IncludeRegion[] } }).__cgSourceMap = { regions };
          }
          newView.dispatch({
            changes: { from: 0, to: newView.state.doc.length, insert: expanded },
          });
        }
      });
    }

    return () => {
      if (wordCountTimerRef.current !== null) {
        clearTimeout(wordCountTimerRef.current);
        wordCountTimerRef.current = null;
      }
      imageSaverRef.current = null;
      // Clear debug references to destroyed view
      const wd = window as unknown as DebugWindow;
      wd.__cmView = undefined;
      wd.__cmDebug = undefined;
      newView.destroy();
      setView(null);
    };
    // doc changes intentionally recreate the editor (same as switchEditor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, containerRef]);

  // ── Theme reconfiguration (no editor recreation needed) ───────────────────
  useEffect(() => {
    if (!view) return;
    const isDark = theme === "dark";
    try {
      view.dispatch({
        effects: themeCompartment.reconfigure(isDark ? chickenglassDarkTheme : []),
      });
    } catch {
      // view already destroyed
    }
  }, [view, theme]);

  return { view, wordCount, cursorPos, scrollTop, viewportFrom, pluginManager, imageSaver: imageSaverRef.current };
}

// ── Re-exports for hook consumers ─────────────────────────────────────────────
export type { FrontmatterState };
