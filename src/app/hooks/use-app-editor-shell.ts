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
import type { FileSystem } from "../file-manager";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import { extractDiagnostics, type DiagnosticEntry } from "../diagnostics";
import type { Settings } from "../lib/types";
import type { SearchNavigationTarget } from "../search";
import type { UnsavedChangesDecision, UnsavedChangesRequest } from "../unsaved-changes";

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
 * Session-level properties (document state, file operations, buffers, dirty
 * tracking) are inherited from {@link UseEditorSessionReturn}.  Shell-level
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
    liveDocs,
    openFile,
    isPathOpen,
    openFileWithContent,
    saveFile: sessionSaveFile,
  } = session;

  const saveFile = useCallback(async () => {
    await sessionSaveFile();
  }, [sessionSaveFile]);

  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);

  const navigation = useEditorNavigation({ openFile, isPathOpen, currentPath });
  const {
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult: handleSearchResultNavigation,
    handleEditorDocumentReady,
    syncView,
  } = navigation;

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);
    syncView(state.view);

    if (state.view) {
      setHeadings(extractHeadings(state.view.state));
      setDiagnostics(extractDiagnostics(state.view.state));
    } else {
      setHeadings([]);
      setDiagnostics([]);
    }
  }, [syncView]);

  const handleHeadingsChange = useCallback((h: HeadingEntry[]) => {
    setHeadings(h);
  }, []);

  const handleDiagnosticsChange = useCallback((d: DiagnosticEntry[]) => {
    setDiagnostics(d);
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
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
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
  }, [currentPath, editorState?.view, isMarkdownFile]);

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
  }, [handleSearchResultNavigation]);

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
    ...session,
    pluginManager,
    saveFile,
    editorState,
    headings,
    diagnostics,
    handleEditorStateChange,
    handleHeadingsChange,
    handleDiagnosticsChange,
    handleEditorDocumentReady,
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
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
