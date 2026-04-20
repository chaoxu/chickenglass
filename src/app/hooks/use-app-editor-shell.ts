import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { useEditorSession, type UseEditorSessionReturn } from "./use-editor-session";
import { useEditorNavigation } from "./use-editor-navigation";
import { useEditorTransactions } from "./use-editor-transactions";
import type { FileSystem } from "../file-manager";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import type { Settings } from "../lib/types";
import type { SearchNavigationTarget } from "../search";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "../unsaved-changes";
import { invalidateImageDataUrl } from "../../render/image-url-cache";
import type { ActiveDocumentSignal } from "../active-document-signal";
import { activeCoflatProduct } from "../../product";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";

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
  onAfterSave?: () => void;
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
  /** Singleton plugin manager; registers all default editor plugins on first render. */
  pluginManager: EditorPluginManager;

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
  handleModeChange: (mode: EditorMode) => void;
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
    addRecentFile,
    onAfterSave,
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
    openFileWithContent: sessionOpenFileWithContent,
    saveFile: sessionSaveFile,
  } = session;

  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const editorViewRef = useRef<EditorView | null>(null);
  const lexicalEditorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const pendingLexicalNavigationRef = useRef<{
    readonly onComplete?: () => void;
    readonly path: string;
    readonly pos: number;
  } | null>(null);

  const { runEditorTransaction } = useEditorTransactions({
    currentPath,
    editorDoc,
    editorHandleRef: lexicalEditorHandleRef,
    getSessionCurrentDocText,
    handleDocumentSnapshot: session.handleDocumentSnapshot,
  });

  const getCurrentDocText = useCallback(() => {
    return runEditorTransaction("debug-read", getSessionCurrentDocText).value;
  }, [getSessionCurrentDocText, runEditorTransaction]);

  const saveFile = useCallback(async () => {
    runEditorTransaction("save", () => undefined);
    await sessionSaveFile();
  }, [runEditorTransaction, sessionSaveFile]);

  const openFile = useCallback(async (path: string) => {
    if (path !== currentPath) {
      runEditorTransaction("search-navigation", () => undefined);
    }
    await sessionOpenFile(path);
  }, [currentPath, runEditorTransaction, sessionOpenFile]);

  const openFileWithContent = useCallback(async (name: string, content: string) => {
    runEditorTransaction("search-navigation", () => undefined);
    await sessionOpenFileWithContent(name, content);
  }, [runEditorTransaction, sessionOpenFileWithContent]);

  const closeCurrentFile = useCallback(async (options?: { discard?: boolean }) => {
    runEditorTransaction("save", () => undefined);
    return session.closeCurrentFile(options);
  }, [runEditorTransaction, session]);

  const saveAs = useCallback(async () => {
    runEditorTransaction("save", () => undefined);
    await session.saveAs();
  }, [runEditorTransaction, session]);

  const handleWindowCloseRequest = useCallback(async () => {
    runEditorTransaction("save", () => undefined);
    return session.handleWindowCloseRequest();
  }, [runEditorTransaction, session]);

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

    if (state.view) {
      setHeadings(extractHeadings(state.view.state));
      setDiagnostics(extractDiagnostics(state.view.state));
    } else {
      setHeadings([]);
      setDiagnostics([]);
    }
  }, [syncView]);

  const handleLexicalEditorReady = useCallback((handle: MarkdownEditorHandle | null) => {
    lexicalEditorHandleRef.current = handle;
  }, []);

  const handleHeadingsChange = useCallback((h: HeadingEntry[]) => {
    setHeadings(h);
  }, []);

  const handleDiagnosticsChange = useCallback((d: DiagnosticEntry[]) => {
    setDiagnostics(d);
  }, []);

  const handleWatchedPathChange = useCallback((path: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    invalidateImageDataUrl(view, path);
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

  const handleInsertImage = useCallback(() => {
    const view = editorState?.view;
    if (view) {
      void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
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
    return normalizeEditorMode("rich", isMarkdownFile);
  }, [modeOverrides, pendingModeOverride, currentPath, isMarkdownFile]);

  // Sync the computed mode into the CM6 view.
  useEffect(() => {
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, editorMode);
  }, [editorState?.view, editorMode]);

  const handleModeChange = useCallback((mode: EditorMode) => {
    const { flush: flushResult } = runEditorTransaction("mode-switch", () => undefined);
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    const applyModeOverride = () => {
      if (currentPath) {
        setModeOverrides((previous) => ({
          ...previous,
          [currentPath]: normalizedMode,
        }));
      }
      setPendingModeOverride((previous) =>
        previous?.path === currentPath ? null : previous,
      );
      const view = editorState?.view;
      if (!view) return;
      setEditorMode(view, normalizedMode);
    };
    if (flushResult.shouldDeferModeSwitch) {
      window.setTimeout(applyModeOverride, 0);
    } else {
      applyModeOverride();
    }
  }, [currentPath, editorState?.view, isMarkdownFile, runEditorTransaction]);

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
    if (activeCoflatProduct.editorEngine === "lexical-wysiwyg") {
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
  }, [currentPath, handleSearchResultNavigation, isMarkdownFile, openFile]);

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
    pluginManager,
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
    handleDirtyChange: session.markCurrentDocumentDirty,
    handleEditorDocumentReady,
    handleLexicalEditorReady,
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
  };
}
