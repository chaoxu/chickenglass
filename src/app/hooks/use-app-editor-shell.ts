import { useCallback, useRef } from "react";
import type { EditorMode } from "../../editor-display-mode";
import type { EditorView } from "@codemirror/view";
import type { UseEditorReturn } from "./use-editor";
import { useEditorSession, type UseEditorSessionReturn } from "./use-editor-session";
import { useEditorNavigation } from "./use-editor-navigation";
import { useEditorTransactions } from "./use-editor-transactions";
import { useEditorModeOverrides } from "./use-editor-mode-overrides";
import { useEditorSurfaceHandles } from "./use-editor-surface-handles";
import { useEditorDropOpen } from "./use-editor-drop-open";
import { useSaveActivity, saveErrorMessage } from "./use-save-activity";
import type { SaveActivity } from "./use-save-activity";
import type { FileSystem } from "../file-manager";
import type { HeadingEntry } from "../heading-ancestry";
import type { DiagnosticEntry } from "../diagnostics";
import type { Settings } from "../lib/types";
import type { SearchNavigationTarget } from "../search";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "../unsaved-changes";
import type { ActiveDocumentSignal } from "../active-document-signal";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import type { AutoSaveFlushOptions, AutoSaveFlushReason } from "./use-auto-save";
import type { EditorDocumentChange } from "../editor-doc-change";
import { saveAsErrorMessage } from "../project-root-errors";

export type { SaveActivity, SaveActivityStatus } from "./use-save-activity";

/** Dependencies injected into the shell hook from the top-level app component. */
export interface AppEditorShellDeps {
  /** FileSystem abstraction (MemoryFileSystem in browser, TauriFileSystem on desktop). */
  fs: FileSystem;
  /** User settings (plugins enabled/disabled, word wrap, line numbers, tab size, etc.). */
  settings: Settings;
  /** Callback to refresh the file-tree sidebar after file-system mutations. */
  refreshTree: (changedPath?: string) => Promise<void>;
  /** Callback to record a newly opened path in the recent-files list. */
  addRecentFile: (path: string) => void;
  /** Lightweight callback fired after every successful save (not tree refresh). */
  onAfterSave?: (path: string) => void | Promise<void>;
  /** Callback fired when an old document path should no longer retain side data. */
  onAfterPathRemoved?: (path: string) => void | Promise<void>;
  /** Callback fired after explicit discard of dirty edits. */
  onAfterDiscard?: (path: string) => void | Promise<void>;
  /** Flush the pending hot-exit backup before shutdown. */
  flushPendingHotExitBackup?: () => Promise<void>;
  /** Flush a pending autosave before replacing, closing, or shutting down the active document. */
  flushPendingAutoSave?: (
    reason: AutoSaveFlushReason,
    options?: AutoSaveFlushOptions,
  ) => Promise<void>;
  /** Ask the user how to handle unsaved changes before replacing the current document. */
  requestUnsavedChangesDecision: (
    request: UnsavedChangesRequest,
  ) => Promise<UnsavedChangesDecision>;
}

/**
 * The full public API surface of the editor shell.
 *
 * Returned by `useAppEditorShell` and consumed by the top-level `App`
 * component (and sub-components via prop-drilling or context).
 *
 * Session-level properties (document state, file operations, dirty tracking)
 * are inherited from {@link UseEditorSessionReturn}. Shell-level
 * additions handle editor state, navigation, insertion, modes, stats, and
 * drag-and-drop.
 */
export interface AppEditorShellController extends UseEditorSessionReturn {
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
  /** Diagnostic entries for the active document (errors and warnings). */
  diagnostics: DiagnosticEntry[];
  /**
   * Called by the `<Editor>` component each time the CM6 view is (re-)mounted
   * or updated. Updates `editorState` and `headings`, and forwards the view
   * to `useEditorNavigation` via `syncView`.
   */
  handleEditorStateChange: (state: UseEditorReturn) => void;
  /**
   * Called by the heading-tracking CM6 extension in `EditorPane` whenever the
   * heading slice revision changes (e.g. when the Lezer parser finishes
   * parsing regions beyond the initial viewport).
   */
  handleHeadingsChange: (headings: HeadingEntry[]) => void;
  /** Called when the diagnostics slice needs updating from a CM6 extension. */
  handleDiagnosticsChange: (diagnostics: DiagnosticEntry[]) => void;
  /** Mark the current document dirty without immediately replacing the markdown snapshot. */
  handleDirtyChange: UseEditorSessionReturn["markCurrentDocumentDirty"];
  /** Called after `useEditor` has applied the current document/path to the live CM6 view. */
  handleEditorDocumentReady: (view: EditorView, docPath: string | undefined) => void;
  /** Called by the Lexical editor surface when its imperative handle is available. */
  handleLexicalEditorReady: (handle: MarkdownEditorHandle | null) => void;
  /** Called when the Lexical surface mounts, clearing stale CM6 state. */
  handleLexicalSurfaceReady: () => void;
  /** Return the current Lexical editor handle without forcing app-shell rerenders. */
  getLexicalEditorHandle: () => MarkdownEditorHandle | null;
  /** Current best-effort save operation state for the active document. */
  saveActivity: SaveActivity;
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
  handleSearchResult: (target: SearchNavigationTarget, onComplete?: () => void) => void;

  // --- Insertion ---

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
  handleModeChange: (mode: EditorMode | string) => void;
  /** True when the active file has a `.md` extension (determines default mode). */
  isMarkdownFile: boolean;

  // --- Stats ---

  /** External signal used by leaf UI surfaces that need live active-document updates. */
  activeDocumentSignal: ActiveDocumentSignal;
  /** Returns the latest active-document text, including unsaved edits. */
  getCurrentDocText: () => string;
  /** True when the current document has unsaved changes (used for window-close guard). */
  hasDirtyDocument: boolean;
  /** React to watched filesystem changes that should invalidate editor-side caches. */
  handleWatchedPathChange: (path: string) => void;

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
  onAfterSave,
  onAfterPathRemoved,
  onAfterDiscard,
  flushPendingHotExitBackup,
  flushPendingAutoSave,
  requestUnsavedChangesDecision,
}: AppEditorShellDeps): AppEditorShellController {
  const session = useEditorSession({
    fs,
    refreshTree,
    addRecentFile,
    onAfterSave,
    onAfterPathRemoved,
    onAfterDiscard,
    requestUnsavedChangesDecision,
  });
  const {
    currentDocument,
    currentPath,
    editorDoc,
    activeDocumentSignal,
    getCurrentDocText: getSessionCurrentDocText,
    openFile: sessionOpenFile,
    isPathOpen,
    isPathDirty,
    openFileWithContent: sessionOpenFileWithContent,
    saveFile: sessionSaveFile,
    saveAs: sessionSaveAs,
    handleDocumentSnapshot: sessionHandleDocumentSnapshot,
  } = session;

  const lexicalEditorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const { clearSaveFailure, saveActivity, trackSaveActivity } = useSaveActivity({
    activeDocumentSignal,
    currentPath,
  });

  const handleDocChange = useCallback((changes: readonly EditorDocumentChange[]) => {
    clearSaveFailure();
    session.handleDocChange(changes);
  }, [clearSaveFailure, session]);

  const handleDocumentSnapshot = useCallback((doc: string) => {
    clearSaveFailure();
    sessionHandleDocumentSnapshot(doc);
  }, [clearSaveFailure, sessionHandleDocumentSnapshot]);

  const markCurrentDocumentDirty = useCallback(() => {
    clearSaveFailure();
    session.markCurrentDocumentDirty();
  }, [clearSaveFailure, session]);

  const handleProgrammaticDocChange = useCallback((path: string, doc: string) => {
    clearSaveFailure();
    session.handleProgrammaticDocChange(path, doc);
  }, [clearSaveFailure, session]);

  const { runEditorTransaction } = useEditorTransactions({
    currentPath,
    editorDoc,
    editorHandleRef: lexicalEditorHandleRef,
    getSessionCurrentDocText,
    handleDocumentSnapshot,
  });

  const getCurrentDocText = useCallback(() => {
    return runEditorTransaction("debug-read", getSessionCurrentDocText).value;
  }, [getSessionCurrentDocText, runEditorTransaction]);

  const saveFile = useCallback(async () => {
    await trackSaveActivity(async () => {
      runEditorTransaction("save", () => undefined);
      await sessionSaveFile();
    }, saveErrorMessage);
  }, [runEditorTransaction, sessionSaveFile, trackSaveActivity]);

  const flushDirtyCurrentDocument = useCallback(async (
    reason: AutoSaveFlushReason,
  ) => {
    if (
      !currentPath ||
      !isPathDirty(currentPath) ||
      !flushPendingAutoSave ||
      settings.autoSaveInterval <= 0
    ) {
      return;
    }
    await flushPendingAutoSave(reason, { force: true });
  }, [
    currentPath,
    flushPendingAutoSave,
    isPathDirty,
    settings.autoSaveInterval,
  ]);

  const flushCurrentHotExitBackup = useCallback(async () => {
    if (!currentPath || !isPathDirty(currentPath) || !flushPendingHotExitBackup) {
      return;
    }
    await flushPendingHotExitBackup();
  }, [currentPath, flushPendingHotExitBackup, isPathDirty]);

  const openFile = useCallback(async (path: string) => {
    if (path !== currentPath) {
      runEditorTransaction("search-navigation", () => undefined);
      await flushCurrentHotExitBackup();
      await flushDirtyCurrentDocument("navigation");
    }
    await sessionOpenFile(path);
  }, [
    currentPath,
    flushCurrentHotExitBackup,
    flushDirtyCurrentDocument,
    runEditorTransaction,
    sessionOpenFile,
  ]);

  const openFileWithContent = useCallback(async (name: string, content: string) => {
    runEditorTransaction("search-navigation", () => undefined);
    await flushCurrentHotExitBackup();
    await flushDirtyCurrentDocument("navigation");
    await sessionOpenFileWithContent(name, content);
  }, [
    flushCurrentHotExitBackup,
    flushDirtyCurrentDocument,
    runEditorTransaction,
    sessionOpenFileWithContent,
  ]);

  const closeCurrentFile = useCallback(async (options?: { discard?: boolean }) => {
    runEditorTransaction("save", () => undefined);
    if (!options?.discard) {
      await flushCurrentHotExitBackup();
      await flushDirtyCurrentDocument("navigation");
    }
    return session.closeCurrentFile(options);
  }, [flushCurrentHotExitBackup, flushDirtyCurrentDocument, runEditorTransaction, session]);

  const saveAs = useCallback(async () => {
    await trackSaveActivity(async () => {
      runEditorTransaction("save", () => undefined);
      await sessionSaveAs();
    }, saveAsErrorMessage);
  }, [runEditorTransaction, sessionSaveAs, trackSaveActivity]);

  const handleWindowCloseRequest = useCallback(async () => {
    runEditorTransaction("save", () => undefined);
    await flushCurrentHotExitBackup();
    await flushDirtyCurrentDocument("shutdown");
    return session.handleWindowCloseRequest();
  }, [flushCurrentHotExitBackup, flushDirtyCurrentDocument, runEditorTransaction, session]);

  const navigation = useEditorNavigation({ openFile, isPathOpen, currentPath });
  const {
    handleOutlineSelect: handleCmOutlineSelect,
    handleGotoLine: handleCmGotoLine,
    handleSearchResult: handleSearchResultNavigation,
    handleEditorDocumentReady,
    syncView,
  } = navigation;

  const {
    diagnostics,
    editorState,
    getLexicalEditorHandle,
    handleDiagnosticsChange,
    handleEditorStateChange,
    handleGotoLine,
    handleHeadingsChange,
    handleInsertImage,
    handleLexicalEditorReady,
    handleLexicalSurfaceReady,
    handleOutlineSelect,
    handleWatchedPathChange,
    headings,
    queueLexicalNavigation,
    clearPendingLexicalNavigation,
  } = useEditorSurfaceHandles({
    currentPath,
    editorDoc,
    editorHandleRef: lexicalEditorHandleRef,
    fs,
    handleCmGotoLine,
    handleCmOutlineSelect,
    syncView,
  });

  const isMarkdownFile = currentPath?.endsWith(".md") ?? false;

  const {
    editorMode,
    handleModeChange,
    handleSearchResult,
  } = useEditorModeOverrides({
    clearPendingLexicalNavigation,
    currentPath,
    editorDoc,
    getSessionCurrentDocText,
    handleSearchResultNavigation,
    isMarkdownFile,
    isPathOpen,
    openFile,
    queueLexicalNavigation,
    runEditorTransaction,
    sessionHandleDocumentSnapshot,
  });

  const hasDirtyDocument = currentDocument?.dirty ?? false;

  const { handleDragOver, handleDrop } = useEditorDropOpen({ openFileWithContent });

  return {
    ...session,
    openFile,
    openFileWithContent,
    saveFile,
    closeCurrentFile,
    saveAs,
    handleWindowCloseRequest,
    editorState,
    headings,
    diagnostics,
    handleEditorStateChange,
    handleHeadingsChange,
    handleDiagnosticsChange,
    handleDirtyChange: markCurrentDocumentDirty,
    handleEditorDocumentReady,
    handleLexicalEditorReady,
    handleLexicalSurfaceReady,
    getLexicalEditorHandle,
    saveActivity,
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleInsertImage,
    editorMode,
    handleModeChange,
    isMarkdownFile,
    activeDocumentSignal,
    getCurrentDocText,
    hasDirtyDocument,
    handleWatchedPathChange,
    handleDragOver,
    handleDrop,
    handleDocChange,
    handleDocumentSnapshot,
    markCurrentDocumentDirty,
    handleProgrammaticDocChange,
  };
}
