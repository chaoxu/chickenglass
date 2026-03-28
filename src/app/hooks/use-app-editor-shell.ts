import { useState, useEffect, useCallback, useMemo } from "react";
import {
  insertImageFromPicker,
  normalizeEditorMode,
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
import { useEditorNavigation } from "./use-editor-navigation";
import type { FileSystem } from "../file-manager";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import type { Settings } from "../lib/types";
import type { SavePipeline } from "../save-pipeline";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "../unsaved-changes";

/** Dependencies injected into the shell hook from the top-level app component. */
export interface AppEditorShellDeps {
  /** FileSystem abstraction (MemoryFileSystem in browser, TauriFileSystem on desktop). */
  fs: FileSystem;
  /** User settings (plugins enabled/disabled, word wrap, line numbers, tab size, etc.). */
  settings: Settings;
  /** Callback to refresh the file-tree sidebar after file-system mutations. */
  refreshTree: () => Promise<void>;
  /** Callback to refresh git working-tree badges after saves. */
  refreshGitStatus: () => Promise<void>;
  /** Callback to record a newly opened path in the recent-files list. */
  addRecentFile: (path: string) => void;
  /** Ask the user how to handle unsaved changes before replacing the current document. */
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
}

/**
 * The full public API surface of the editor shell.
 *
 * Returned by `useAppEditorShell` and consumed by the top-level `App`
 * component (and sub-components via prop-drilling or context). This
 * interface is the single source of truth for what the shell exposes —
 * everything in the app that touches files, editor state, or modes
 * goes through here.
 *
 * Property groups:
 * - **Session / document** (`currentDocument`, `currentPath`, `openFile`, `closeCurrentFile`, …):
 *   Delegates to `useEditorSession`; manages the current document and in-memory buffers.
 * - **Editor state** (`editorState`, `headings`, `handleEditorStateChange`):
 *   Tracks the live CM6 `EditorView` and derived heading list.
 * - **Navigation** (`handleOutlineSelect`, `handleGotoLine`, `handleSearchResult`):
 *   Scrolls the view to a position, a 1-based line/col, or a cross-file search hit.
 * - **Insertion** (`handleSymbolInsert`, `handleInsertImage`):
 *   Inserts content at the cursor without the caller needing a CM6 reference.
 * - **Mode** (`editorMode`, `handleModeChange`, `isMarkdownFile`):
 *   Controls the rich / source mode per file.
 * - **Stats** (`docTextForStats`, `hasDirtyDocument`):
 *   Read-only derived values for the status bar and window-title indicator.
 * - **Drag-and-drop** (`handleDragOver`, `handleDrop`):
 *   Accepts `.md` files dragged onto the editor surface.
 */
export interface AppEditorShellController {
  /** Singleton plugin manager; registers all default editor plugins on first render. */
  pluginManager: EditorPluginManager;

  /** Save pipeline for coordinating writes, revision tracking, and self-change suppression. */
  pipeline: SavePipeline;

  // --- Session / current document (delegated to useEditorSession) ---

  /** The single document currently open in this window, or null when empty. */
  currentDocument: ReturnType<typeof useEditorSession>["currentDocument"];
  /** Path of the current document, or null when no file is open. */
  currentPath: ReturnType<typeof useEditorSession>["currentPath"];
  /** The CM6 document text for the current document (kept in sync with the editor). */
  editorDoc: ReturnType<typeof useEditorSession>["editorDoc"];
  /** Replace the CM6 document text programmatically (e.g. after include expansion). */
  setEditorDoc: ReturnType<typeof useEditorSession>["setEditorDoc"];
  /**
   * In-memory text buffers keyed by file path.
   * Holds the last-known content for the current file and any temporary
   * replacements during document transitions.
   */
  buffers: ReturnType<typeof useEditorSession>["buffers"];
  /**
   * Ref to a Map of live document text for the current file.
   * Unlike `buffers`, this map is updated on every keystroke so it reflects
   * unsaved changes; used for word-count stats and dirty detection.
   */
  liveDocs: ReturnType<typeof useEditorSession>["liveDocs"];
  /** Returns true if the given path is the current document. */
  isPathOpen: ReturnType<typeof useEditorSession>["isPathOpen"];
  /** Returns true if the given path is dirty in the current window. */
  isPathDirty: ReturnType<typeof useEditorSession>["isPathDirty"];
  /** Invalidate any in-flight openFile request that should no longer commit. */
  cancelPendingOpenFile: ReturnType<typeof useEditorSession>["cancelPendingOpenFile"];
  /** Open a file by path from the filesystem, replacing the current document if needed. */
  openFile: ReturnType<typeof useEditorSession>["openFile"];
  /** Open a virtual file from an in-memory string (e.g. a dragged-in `.md` file). */
  openFileWithContent: ReturnType<typeof useEditorSession>["openFileWithContent"];
  /** Reload the current document from disk. */
  reloadFile: ReturnType<typeof useEditorSession>["reloadFile"];
  /** Persist the active file to the filesystem. */
  saveFile: ReturnType<typeof useEditorSession>["saveFile"];
  /** Create a new empty file at the given path. */
  createFile: ReturnType<typeof useEditorSession>["createFile"];
  /** Create a new directory at the given path. */
  createDirectory: ReturnType<typeof useEditorSession>["createDirectory"];
  /** Close the current document, prompting to save if dirty. */
  closeCurrentFile: ReturnType<typeof useEditorSession>["closeCurrentFile"];
  /** Rename a file on disk and update the current-document reference if needed. */
  handleRename: ReturnType<typeof useEditorSession>["handleRename"];
  /** Delete a file from disk and close it if it is currently open. */
  handleDelete: ReturnType<typeof useEditorSession>["handleDelete"];
  /** Save the active file to a new path chosen by the user. */
  saveAs: ReturnType<typeof useEditorSession>["saveAs"];
  /** Decide whether a native window close should proceed. */
  handleWindowCloseRequest: ReturnType<typeof useEditorSession>["handleWindowCloseRequest"];
  /** Notify the session that the CM6 document changed (marks the current document dirty, updates liveDocs). */
  handleDocChange: ReturnType<typeof useEditorSession>["handleDocChange"];
  /** Sync annotated CM6 document replacements without treating them as user edits. */
  handleProgrammaticDocChange: ReturnType<typeof useEditorSession>["handleProgrammaticDocChange"];
  /** Register or clear the include source map for the active document. */
  setDocumentSourceMap: ReturnType<typeof useEditorSession>["setDocumentSourceMap"];

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
   * or updated. Updates `editorState` and `headings`, and forwards the view
   * to `useEditorNavigation` via `syncView`.
   */
  handleEditorStateChange: (state: UseEditorReturn) => void;
  /** Called after `useEditor` has applied the current document/path to the live CM6 view. */
  handleEditorDocumentReady: (view: EditorView, docPath: string | undefined) => void;

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
   * Open `file` (if it is not already current) then scroll to character offset `pos`.
   * Uses a stable view ref (inside `useEditorNavigation`) instead of the
   * closure over `editorState` so the view reference is always fresh after
   * the async `openFile` resolves.
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
   * Current editor display mode for the current document.
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

  /**
   * Raw text of the active document used for word-count and reading-time
   * calculations. Reads from `liveDocs` (reflects unsaved changes) rather than
   * the saved buffer so stats stay current while typing.
   */
  docTextForStats: string;
  /** True when the current document has unsaved changes (used for window-close guard). */
  hasDirtyDocument: boolean;

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
  refreshGitStatus,
  addRecentFile,
  requestUnsavedChangesDecision,
}: AppEditorShellDeps): AppEditorShellController {
  const [pluginManager] = useState(() => {
    const manager = new EditorPluginManager();
    defaultEditorPlugins.forEach((plugin) => manager.register(plugin));
    return manager;
  });

  const session = useEditorSession({
    fs,
    refreshTree,
    refreshGitStatus,
    addRecentFile,
    requestUnsavedChangesDecision,
  });
  const {
    currentDocument,
    currentPath,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    pipeline,
    isPathOpen,
    isPathDirty,
    cancelPendingOpenFile,
    handleDocChange,
    handleProgrammaticDocChange,
    setDocumentSourceMap,
    openFile,
    openFileWithContent,
    reloadFile,
    saveFile: sessionSaveFile,
    createFile,
    createDirectory,
    closeCurrentFile,
    handleRename,
    handleDelete,
    saveAs,
    handleWindowCloseRequest,
  } = session;

  const saveFile = useCallback(async () => {
    await sessionSaveFile();
    void refreshGitStatus();
  }, [sessionSaveFile, refreshGitStatus]);

  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);

  const navigation = useEditorNavigation({ openFile, isPathOpen, currentPath });
  const {
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleEditorDocumentReady,
    syncView,
  } = navigation;

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    syncView(state.view);

    if (state.view) {
      setHeadings(extractHeadings(state.view.state));
    } else {
      setHeadings([]);
    }
  }, [syncView]);

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

  const isMarkdownFile = currentPath?.endsWith(".md") ?? false;

  // editorMode is derived from (currentPath, isMarkdownFile) via useMemo rather
  // than being stored in a separate useState that is then synced via useEffect.
  // An optional override captures user-initiated mode changes (handleModeChange)
  // and is keyed to the current path so it is automatically discarded when
  // the user switches to a different file.
  const [modeOverride, setModeOverride] = useState<{ path: string | null; mode: EditorMode } | null>(null);

  const editorMode = useMemo((): EditorMode => {
    // If the user explicitly changed mode for the current tab, honour it.
    if (modeOverride && modeOverride.path === currentPath) {
      return normalizeEditorMode(modeOverride.mode, isMarkdownFile);
    }
    return normalizeEditorMode("rich", isMarkdownFile);
  }, [modeOverride, currentPath, isMarkdownFile]);

  // Sync the computed mode into the CM6 view.
  useEffect(() => {
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, editorMode);
  }, [editorState?.view, editorMode]);

  const handleModeChange = useCallback((mode: EditorMode) => {
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    setModeOverride({ path: currentPath, mode: normalizedMode });
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, normalizedMode);
  }, [currentPath, editorState?.view, isMarkdownFile]);

  const docTextForStats = currentPath ? (liveDocs.current.get(currentPath) ?? "") : "";

  const hasDirtyDocument = currentDocument?.dirty ?? false;

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
    pipeline,
    currentDocument,
    currentPath,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    isPathOpen,
    isPathDirty,
    cancelPendingOpenFile,
    openFile,
    openFileWithContent,
    reloadFile,
    saveFile,
    createFile,
    createDirectory,
    closeCurrentFile,
    handleRename,
    handleDelete,
    saveAs,
    handleWindowCloseRequest,
    handleDocChange,
    handleProgrammaticDocChange,
    setDocumentSourceMap,
    editorState,
    headings,
    handleEditorStateChange,
    handleEditorDocumentReady,
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleSymbolInsert,
    handleInsertImage,
    editorMode,
    handleModeChange,
    isMarkdownFile,
    docTextForStats,
    hasDirtyDocument,
    handleDragOver,
    handleDrop,
  };
}
