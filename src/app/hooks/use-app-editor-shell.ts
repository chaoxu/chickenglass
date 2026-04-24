import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  defaultEditorMode,
  isLexicalEditorMode,
  normalizeEditorMode,
  type EditorMode,
} from "../../editor-display-mode";
import type { EditorView } from "@codemirror/view";
import type { UseEditorReturn } from "./use-editor";
import { useEditorSession, type UseEditorSessionReturn } from "./use-editor-session";
import { useEditorNavigation } from "./use-editor-navigation";
import { useEditorTransactions } from "./use-editor-transactions";
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

interface PendingModeOverride {
  path: string;
  mode: EditorMode;
  requestId: number;
}

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

export type SaveActivityStatus = "failed" | "idle" | "saving";

export interface SaveActivity {
  status: SaveActivityStatus;
  message?: string;
}

function saveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "Save failed";
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
    handleDocumentSnapshot: sessionHandleDocumentSnapshot,
  } = session;

  const [saveActivity, setSaveActivity] = useState<SaveActivity>({ status: "idle" });
  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const editorViewRef = useRef<EditorView | null>(null);
  const lexicalEditorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const saveActivityTokenRef = useRef(0);
  const pendingLexicalNavigationRef = useRef<{
    readonly onComplete?: () => void;
    readonly path: string;
    readonly pos: number;
  } | null>(null);

  const clearSaveFailure = useCallback(() => {
    setSaveActivity((previous) =>
      previous.status === "failed" ? { status: "idle" } : previous,
    );
  }, []);

  useEffect(() => {
    saveActivityTokenRef.current += 1;
    setSaveActivity({ status: "idle" });
  }, [currentPath]);

  useEffect(() => {
    return activeDocumentSignal.subscribe(clearSaveFailure);
  }, [activeDocumentSignal, clearSaveFailure]);

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
    const saveToken = ++saveActivityTokenRef.current;
    setSaveActivity({ status: "saving" });
    runEditorTransaction("save", () => undefined);
    try {
      await sessionSaveFile();
      setSaveActivity((previous) =>
        saveActivityTokenRef.current === saveToken && previous.status === "saving"
          ? { status: "idle" }
          : previous,
      );
    } catch (error: unknown) {
      if (saveActivityTokenRef.current === saveToken) {
        setSaveActivity({ status: "failed", message: saveErrorMessage(error) });
      }
      throw error;
    }
  }, [runEditorTransaction, sessionSaveFile]);

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
    const saveToken = ++saveActivityTokenRef.current;
    setSaveActivity({ status: "saving" });
    runEditorTransaction("save", () => undefined);
    try {
      await session.saveAs();
      setSaveActivity((previous) =>
        saveActivityTokenRef.current === saveToken && previous.status === "saving"
          ? { status: "idle" }
          : previous,
      );
    } catch (error: unknown) {
      if (saveActivityTokenRef.current === saveToken) {
        setSaveActivity({ status: "failed", message: saveAsErrorMessage(error) });
      }
      throw error;
    }
  }, [runEditorTransaction, session]);

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

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    editorViewRef.current = state.view;
    syncView(state.view);
  }, [syncView]);

  const handleLexicalSurfaceReady = useCallback(() => {
    setEditorState(null);
    editorViewRef.current = null;
    syncView(null);
    setHeadings([]);
    setDiagnostics([]);
  }, [syncView]);

  const handleLexicalEditorReady = useCallback((handle: MarkdownEditorHandle | null) => {
    lexicalEditorHandleRef.current = handle;
    if (!handle) return;
    const pending = pendingLexicalNavigationRef.current;
    if (!pending || pending.path !== currentPath) return;
    pendingLexicalNavigationRef.current = null;
    handle.setSelection(pending.pos, pending.pos);
    handle.focus();
    pending.onComplete?.();
  }, [currentPath]);
  const getLexicalEditorHandle = useCallback(() => lexicalEditorHandleRef.current, []);

  const handleHeadingsChange = useCallback((h: HeadingEntry[]) => {
    setHeadings(h);
  }, []);

  const handleDiagnosticsChange = useCallback((d: DiagnosticEntry[]) => {
    setDiagnostics(d);
  }, []);

  const handleWatchedPathChange = useCallback((path: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    void import("../../render/image-url-cache").then(({ invalidateImageDataUrl }) => {
      if (editorViewRef.current !== view) return;
      invalidateImageDataUrl(view, path);
    });
  }, []);

  const handleInsertImage = useCallback(() => {
    const view = editorState?.view;
    if (view) {
      void import("../../editor").then(({ insertImageFromPicker }) => {
        if (editorViewRef.current !== view) return;
        void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
      });
    }
  }, [editorState?.view, editorState?.imageSaver]);

  const isMarkdownFile = currentPath?.endsWith(".md") ?? false;

  // Persist mode overrides per file so explicit mode choices survive tab/file
  // switches, including cross-file search navigation that sets the target
  // file's mode before it becomes current.
  const [modeOverrides, setModeOverrides] = useState<Record<string, EditorMode>>({});
  const [pendingModeOverride, setPendingModeOverride] = useState<PendingModeOverride | null>(null);
  const pendingModeRequestIdRef = useRef(0);

  const editorMode = useMemo((): EditorMode => {
    const override = currentPath ? modeOverrides[currentPath] : undefined;
    if (override !== undefined) {
      return normalizeEditorMode(override, isMarkdownFile);
    }
    if (pendingModeOverride && pendingModeOverride.path === currentPath) {
      return normalizeEditorMode(pendingModeOverride.mode, isMarkdownFile);
    }
    return normalizeEditorMode(defaultEditorMode, isMarkdownFile);
  }, [modeOverrides, pendingModeOverride, currentPath, isMarkdownFile]);

  const handleModeChange = useCallback((mode: EditorMode | string) => {
    const { flush: flushResult } = runEditorTransaction("mode-switch", () => undefined);
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    const applyModeOverride = () => {
      const finishModeOverride = () => {
        if (currentPath) {
          setModeOverrides((previous) => ({
            ...previous,
            [currentPath]: normalizedMode,
          }));
        }
        setPendingModeOverride((previous) =>
          previous?.path === currentPath ? null : previous,
        );
      };
      if (
        isLexicalEditorMode(normalizedMode) &&
        !isLexicalEditorMode(editorMode)
      ) {
        const liveDoc = getSessionCurrentDocText();
        if (liveDoc !== editorDoc) {
          sessionHandleDocumentSnapshot(liveDoc);
          window.setTimeout(finishModeOverride, 0);
          return;
        }
      }
      finishModeOverride();
    };
    if (flushResult.shouldDeferModeSwitch) {
      window.setTimeout(applyModeOverride, 0);
    } else {
      applyModeOverride();
    }
  }, [
    currentPath,
    editorDoc,
    editorMode,
    getSessionCurrentDocText,
    isMarkdownFile,
    runEditorTransaction,
    sessionHandleDocumentSnapshot,
  ]);

  const handleOutlineSelect = useCallback((from: number) => {
    const lexicalHandle = lexicalEditorHandleRef.current;
    if (lexicalHandle) {
      lexicalHandle.setSelection(from, from);
      lexicalHandle.focus();
      return;
    }
    handleCmOutlineSelect(from);
  }, [handleCmOutlineSelect]);

  const handleGotoLine = useCallback((line: number, col?: number) => {
    const lexicalHandle = lexicalEditorHandleRef.current;
    if (lexicalHandle) {
      const doc = lexicalHandle.peekDoc();
      const lines = doc.split(/\r\n|\n|\r/);
      const clampedLine = Math.max(1, Math.min(line, lines.length));
      const lineStart = lines
        .slice(0, clampedLine - 1)
        .reduce((offset, currentLine) => offset + currentLine.length + 1, 0);
      const lineText = lines[clampedLine - 1] ?? "";
      const offset = lineStart + Math.max(0, Math.min((col ?? 1) - 1, lineText.length));
      lexicalHandle.setSelection(offset, offset);
      lexicalHandle.focus();
      return;
    }
    handleCmGotoLine(line, col);
  }, [handleCmGotoLine]);

  useEffect(() => {
    const pending = pendingLexicalNavigationRef.current;
    const lexicalHandle = lexicalEditorHandleRef.current;
    if (!pending || !lexicalHandle || pending.path !== currentPath) {
      return;
    }
    pendingLexicalNavigationRef.current = null;
    lexicalHandle.setSelection(pending.pos, pending.pos);
    lexicalHandle.focus();
    pending.onComplete?.();
  }, [currentPath, editorDoc]);

  const handleSearchResult = useCallback((
    target: SearchNavigationTarget,
    onComplete?: () => void,
  ) => {
    const targetIsMarkdown = target.file.endsWith(".md");
    const normalizedMode = normalizeEditorMode(target.editorMode, targetIsMarkdown);
    const requestId = ++pendingModeRequestIdRef.current;
    setPendingModeOverride({
      path: target.file,
      mode: normalizedMode,
      requestId,
    });
    if (isLexicalEditorMode(normalizedMode)) {
      pendingLexicalNavigationRef.current = {
        onComplete,
        path: target.file,
        pos: target.pos,
      };
      void openFile(target.file).catch((error: unknown) => {
        pendingLexicalNavigationRef.current = null;
        console.error("[editor] handleSearchResult: failed to open file", target.file, error);
        onComplete?.();
      });
      return;
    }

    void handleSearchResultNavigation(target.file, target.pos, onComplete).then((opened) => {
      setPendingModeOverride((previous) => {
        if (!previous || previous.requestId !== requestId) {
          return previous;
        }
        return null;
      });
      if (!opened) {
        return;
      }
      setModeOverrides((previous) => ({
        ...previous,
        [target.file]: normalizedMode,
      }));
    });
  }, [handleSearchResultNavigation, openFile]);

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
