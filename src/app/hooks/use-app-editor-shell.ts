import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  insertImageFromPicker,
  setEditorMode,
  wordWrapCompartment,
  lineNumbersCompartment,
  tabSizeCompartment,
  tabSizeExtension,
  defaultEditorPlugins,
  EditorPluginManager,
  type EditorMode,
} from "../../editor";
import { EditorView, lineNumbers } from "@codemirror/view";
import type { UseEditorReturn } from "./use-editor";
import { useEditorSession } from "./use-editor-session";
import type { FileSystem } from "../file-manager";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import type { Settings } from "../lib/types";

/** Dependencies injected into the shell hook from the top-level app component. */
export interface AppEditorShellDeps {
  /** FileSystem abstraction (MemoryFileSystem in browser, TauriFileSystem on desktop). */
  fs: FileSystem;
  /** User settings (plugins enabled/disabled, word wrap, line numbers, tab size, etc.). */
  settings: Settings;
  /** Callback to refresh the file-tree sidebar after file-system mutations. */
  refreshTree: () => Promise<void>;
  /** Callback to record a newly opened path in the recent-files list. */
  addRecentFile: (path: string) => void;
}

/**
 * The full public API surface of the editor shell.
 *
 * Returned by `useAppEditorShell` and consumed by the top-level `App`
 * component (and sub-components via prop-drilling or context). This
 * interface is the single source of truth for what the shell exposes —
 * everything in the app that touches tabs, files, editor state, or modes
 * goes through here.
 *
 * Property groups:
 * - **Session / tabs** (`openTabs`, `activeTab`, `openFile`, `closeFile`, …):
 *   Delegates to `useEditorSession`; manages the tab strip and per-file buffers.
 * - **Editor state** (`editorState`, `headings`, `handleEditorStateChange`):
 *   Tracks the live CM6 `EditorView` and derived heading list.
 * - **Navigation** (`handleOutlineSelect`, `handleGotoLine`, `handleSearchResult`):
 *   Scrolls the view to a position, a 1-based line/col, or a cross-file search hit.
 * - **Insertion** (`handleSymbolInsert`, `handleInsertImage`):
 *   Inserts content at the cursor without the caller needing a CM6 reference.
 * - **Mode** (`editorMode`, `handleModeChange`, `isMarkdownFile`):
 *   Controls the rich / source / read mode per file.
 * - **Stats** (`wordCount`, `cursorLineCol`, `docTextForStats`, `hasDirtyFiles`):
 *   Read-only derived values for the status bar and window-title indicator.
 * - **Drag-and-drop** (`handleDragOver`, `handleDrop`):
 *   Accepts `.md` files dragged onto the editor surface.
 */
export interface AppEditorShellController {
  /** Singleton plugin manager; registers all default editor plugins on first render. */
  pluginManager: EditorPluginManager;

  // --- Session / tab management (delegated to useEditorSession) ---

  /** Ordered list of currently open tabs (path, name, dirty flag, preview flag). */
  openTabs: ReturnType<typeof useEditorSession>["openTabs"];
  /** Path of the currently active (visible) tab, or null when no file is open. */
  activeTab: ReturnType<typeof useEditorSession>["activeTab"];
  /** The CM6 document text for the active tab (kept in sync with the editor). */
  editorDoc: ReturnType<typeof useEditorSession>["editorDoc"];
  /** Replace the CM6 document text programmatically (e.g. after include expansion). */
  setEditorDoc: ReturnType<typeof useEditorSession>["setEditorDoc"];
  /**
   * In-memory text buffers keyed by file path.
   * Holds the last-known content for each open file even when it is not the active tab.
   */
  buffers: ReturnType<typeof useEditorSession>["buffers"];
  /**
   * Ref to a Map of live document text for all open files.
   * Unlike `buffers`, this map is updated on every keystroke so it reflects
   * unsaved changes; used for word-count stats and dirty detection.
   */
  liveDocs: ReturnType<typeof useEditorSession>["liveDocs"];
  /** Returns true if the given path is already open in any tab. */
  isPathOpen: ReturnType<typeof useEditorSession>["isPathOpen"];
  /** Open a file by path from the filesystem, reading its content if not cached. */
  openFile: ReturnType<typeof useEditorSession>["openFile"];
  /** Open a virtual file from an in-memory string (e.g. a dragged-in `.md` file). */
  openFileWithContent: ReturnType<typeof useEditorSession>["openFileWithContent"];
  /** Reorder the tab strip after a drag-and-drop re-sort. */
  reorderTabs: ReturnType<typeof useEditorSession>["reorderTabs"];
  /** Persist the active file to the filesystem. */
  saveFile: ReturnType<typeof useEditorSession>["saveFile"];
  /** Create a new empty file at the given path. */
  createFile: ReturnType<typeof useEditorSession>["createFile"];
  /** Create a new directory at the given path. */
  createDirectory: ReturnType<typeof useEditorSession>["createDirectory"];
  /** Close a tab, prompting to save if dirty. */
  closeFile: ReturnType<typeof useEditorSession>["closeFile"];
  /** Rename a file on disk and update all open-tab references. */
  handleRename: ReturnType<typeof useEditorSession>["handleRename"];
  /** Delete a file from disk and close its tab if open. */
  handleDelete: ReturnType<typeof useEditorSession>["handleDelete"];
  /** Save the active file to a new path chosen by the user. */
  saveAs: ReturnType<typeof useEditorSession>["saveAs"];
  /** Promote a preview tab to a permanent tab (prevents it from being replaced). */
  pinTab: ReturnType<typeof useEditorSession>["pinTab"];
  /** Activate an already-open tab by path. */
  switchToTab: ReturnType<typeof useEditorSession>["switchToTab"];
  /** Notify the session that the CM6 document changed (marks tab dirty, updates liveDocs). */
  handleDocChange: ReturnType<typeof useEditorSession>["handleDocChange"];

  // --- Editor state ---

  /**
   * Current CM6 editor state bundle from `useEditor`, or null before the
   * editor mounts. Re-set on every tab switch via `handleEditorStateChange`.
   */
  editorState: UseEditorReturn | null;
  /**
   * Heading entries extracted from the active document's syntax tree.
   * Updated on every `handleEditorStateChange` call; used by the outline panel
   * and the breadcrumb bar.
   */
  headings: HeadingEntry[];
  /**
   * Called by the `<Editor>` component each time the CM6 view is (re-)mounted
   * or updated. Updates `editorState`, `latestViewRef`, and `headings`.
   */
  handleEditorStateChange: (state: UseEditorReturn) => void;

  // --- Navigation ---

  /**
   * Scroll the editor to `from` (a document character offset) and focus it.
   * Used by the outline panel when the user clicks a heading entry.
   */
  handleOutlineSelect: (from: number) => void;
  /**
   * Move the cursor to a 1-based line and optional 1-based column, then scroll
   * into view. Line numbers are clamped to the document range.
   */
  handleGotoLine: (line: number, col?: number) => void;
  /**
   * Open `file` (if not already active) then scroll to character offset `pos`.
   * Uses a stable `latestViewRef` instead of the closure over `editorState`
   * so the view reference is always fresh after the async `openFile` resolves.
   * Calls `onComplete` when navigation finishes.
   */
  handleSearchResult: (file: string, pos: number, onComplete?: () => void) => void;

  // --- Insertion ---

  /**
   * Insert a LaTeX string at the current cursor position without exposing the
   * CM6 view to the caller. Used by the symbol picker panel.
   */
  handleSymbolInsert: (latex: string) => void;
  /**
   * Open the native file picker to select an image, then insert it into the
   * document (as a data URL or saved file, depending on frontmatter imageFolder).
   */
  handleInsertImage: () => void;

  // --- Mode ---

  /**
   * Current editor display mode for the active tab.
   * Derived from `isMarkdownFile` with a per-tab user override;
   * automatically resets to default when the user switches to a different file.
   */
  editorMode: EditorMode;
  /**
   * Explicitly set the display mode for the active tab.
   * Stores a per-tab override so switching tabs restores the per-file mode.
   */
  handleModeChange: (mode: EditorMode) => void;
  /** True when the active file has a `.md` extension (determines default mode). */
  isMarkdownFile: boolean;

  // --- Stats ---

  /** Word count for the active document, as reported by `useEditor`. */
  wordCount: number;
  /**
   * 1-based line and column of the cursor in the active document.
   * Derived from `editorState.cursorPos` each render; returns {1,1} on error.
   */
  cursorLineCol: { line: number; col: number };
  /**
   * Raw text of the active document used for word-count and reading-time
   * calculations. Reads from `liveDocs` (reflects unsaved changes) rather than
   * the saved buffer so stats stay current while typing.
   */
  docTextForStats: string;
  /** True when at least one open tab has unsaved changes (used for window-close guard). */
  hasDirtyFiles: boolean;

  // --- Drag-and-drop ---

  /** Allow drag events over the editor surface (sets dropEffect = "copy"). */
  handleDragOver: (e: React.DragEvent) => void;
  /**
   * Accept `.md` files dropped onto the editor surface.
   * Each file is read as text and opened via `openFileWithContent`.
   */
  handleDrop: (e: React.DragEvent) => void;
}

export function useAppEditorShell({
  fs,
  settings,
  refreshTree,
  addRecentFile,
}: AppEditorShellDeps): AppEditorShellController {
  const [pluginManager] = useState(() => {
    const manager = new EditorPluginManager();
    defaultEditorPlugins.forEach((plugin) => manager.register(plugin));
    return manager;
  });

  const session = useEditorSession({
    fs,
    refreshTree,
    addRecentFile,
  });
  const {
    openTabs,
    activeTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    isPathOpen,
    handleDocChange,
    switchToTab,
    reorderTabs,
    openFile,
    openFileWithContent,
    saveFile,
    createFile,
    createDirectory,
    closeFile,
    handleRename,
    handleDelete,
    saveAs,
    pinTab,
  } = session;

  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  // Stable ref always pointing at the latest view, so async callbacks (e.g.
  // handleSearchResult) never capture a stale closure after openFile resolves.
  const latestViewRef = useRef<UseEditorReturn["view"]>(null);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    latestViewRef.current = state.view;

    if (state.view) {
      setHeadings(extractHeadings(state.view.state));
    } else {
      setHeadings([]);
    }
  }, []);

  useEffect(() => {
    const view = editorState?.view ?? null;
    for (const { plugin, enabled } of pluginManager.getPlugins()) {
      const settingEnabled = settings.enabledPlugins[plugin.id];
      if (settingEnabled !== undefined && settingEnabled !== enabled) {
        pluginManager.setEnabled(view, plugin.id, settingEnabled);
      }
    }
  }, [settings.enabledPlugins, editorState?.view, pluginManager]);

  // Sync wordWrap, showLineNumbers, tabSize settings to CM6 compartments
  useEffect(() => {
    const view = editorState?.view;
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
  }, [editorState?.view, settings.wordWrap, settings.showLineNumbers, settings.tabSize]);

  const handleOutlineSelect = useCallback((from: number) => {
    const view = editorState?.view;
    if (!view) return;
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  }, [editorState?.view]);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    const view = editorState?.view;
    if (!view) return;
    const docLine = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    const offset = docLine.from + (col ? col - 1 : 0);
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
  }, [editorState?.view]);

  const handleSearchResult = useCallback((file: string, pos: number, onComplete?: () => void) => {
    void (async () => {
      try {
        await openFile(file);
        setTimeout(() => {
          // Use latestViewRef so we get the view after openFile has updated
          // editorState — the closure over editorState?.view would be stale.
          const view = latestViewRef.current;
          if (view) {
            view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
            view.focus();
          }
          onComplete?.();
        }, 100);
      } catch (e: unknown) {
        console.error("[editor] handleSearchResult: failed to open file", file, e);
      }
    })();
  }, [openFile]);

  const handleSymbolInsert = useCallback((latex: string) => {
    const view = editorState?.view;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, insert: latex } });
    view.focus();
  }, [editorState?.view]);

  const handleInsertImage = useCallback(() => {
    const view = editorState?.view;
    if (view) {
      void insertImageFromPicker(view, editorState?.imageSaver ?? undefined).catch((e: unknown) => {
        console.error("[editor] insertImageFromPicker failed", e);
      });
    }
  }, [editorState?.view, editorState?.imageSaver]);

  const isMarkdownFile = activeTab?.endsWith(".md") ?? false;

  // editorMode is derived from (activeTab, isMarkdownFile) via useMemo rather
  // than being stored in a separate useState that is then synced via useEffect.
  // An optional override captures user-initiated mode changes (handleModeChange)
  // and is keyed to the current activeTab so it is automatically discarded when
  // the user switches to a different file.
  const [modeOverride, setModeOverride] = useState<{ tab: string | null; mode: EditorMode } | null>(null);

  const editorMode = useMemo((): EditorMode => {
    // If the user explicitly changed mode for the current tab, honour it.
    if (modeOverride && modeOverride.tab === activeTab) return modeOverride.mode;
    return isMarkdownFile ? "rich" : "source";
  }, [modeOverride, activeTab, isMarkdownFile]);

  // Sync the computed mode into the CM6 view.
  useEffect(() => {
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, editorMode);
  }, [editorState?.view, editorMode]);

  const handleModeChange = useCallback((mode: EditorMode) => {
    setModeOverride({ tab: activeTab, mode });
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, mode);
  }, [activeTab, editorState?.view]);

  const wordCount = editorState?.wordCount ?? 0;
  const cursorCharOffset = editorState?.cursorPos ?? 0;

  const cursorLineCol = useMemo(() => {
    const view = editorState?.view;
    if (!view) return { line: 1, col: 1 };
    try {
      const line = view.state.doc.lineAt(cursorCharOffset);
      return { line: line.number, col: cursorCharOffset - line.from + 1 };
    } catch {
      // best-effort: cursor offset may be stale after doc change — return default position
      return { line: 1, col: 1 };
    }
  }, [editorState?.view, cursorCharOffset]);

  const docTextForStats = activeTab ? (liveDocs.current.get(activeTab) ?? "") : "";

  const hasDirtyFiles = useMemo(() => openTabs.some((tab) => tab.dirty), [openTabs]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.name.endsWith(".md")) {
        void file.text().then((text) => {
          openFileWithContent(file.name, text);
        });
      }
    }
  }, [openFileWithContent]);

  return {
    pluginManager,
    openTabs,
    activeTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    isPathOpen,
    openFile,
    openFileWithContent,
    reorderTabs,
    saveFile,
    createFile,
    createDirectory,
    closeFile,
    handleRename,
    handleDelete,
    saveAs,
    pinTab,
    switchToTab,
    handleDocChange,
    editorState,
    headings,
    handleEditorStateChange,
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleSymbolInsert,
    handleInsertImage,
    editorMode,
    handleModeChange,
    isMarkdownFile,
    wordCount,
    cursorLineCol,
    docTextForStats,
    hasDirtyFiles,
    handleDragOver,
    handleDrop,
  };
}
