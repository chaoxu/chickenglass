import { useState, useCallback, useMemo, useRef } from "react";

import type { LexicalEditor } from "lexical";

import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import { dispatchNavigateSourcePositionEvent } from "../../constants/events";
import { type DiagnosticEntry } from "../diagnostics";
import { useDiagnostics } from "../../state/diagnostics-store";
import { type HeadingEntry } from "../heading-ancestry";
import type { Settings } from "../lib/types";
import { normalizeEditorMode, type EditorMode } from "../editor-mode";
import { EditorPluginManager, defaultEditorPlugins } from "../plugin-manager";
import type { FileSystem } from "../file-manager";
import type { SearchNavigationTarget } from "../search";
import { useEditorNavigation } from "./use-editor-navigation";
import { useEditorSession, type UseEditorSessionReturn } from "./use-editor-session";
import { useEditorTransactions } from "./use-editor-transactions";

interface PendingModeOverride {
  readonly path: string;
  readonly mode: EditorMode;
  readonly requestId: number;
}

async function pickImageAsDataUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        input.remove();
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        input.remove();
        resolve(typeof reader.result === "string" ? reader.result : null);
      });
      reader.addEventListener("error", () => {
        input.remove();
        resolve(null);
      });
      reader.readAsDataURL(file);
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  });
}

export interface AppEditorShellDeps {
  readonly fs: FileSystem;
  readonly settings: Settings;
  readonly refreshTree: (changedPath?: string) => Promise<void>;
  readonly addRecentFile: (path: string) => void;
  readonly onAfterSave?: () => void;
  readonly requestUnsavedChangesDecision: (
    request: import("../unsaved-changes").UnsavedChangesRequest,
  ) => Promise<import("../unsaved-changes").UnsavedChangesDecision>;
}

export interface AppEditorDocumentState {
  readonly currentDocument: UseEditorSessionReturn["currentDocument"];
  readonly currentPath: UseEditorSessionReturn["currentPath"];
  readonly editorDoc: UseEditorSessionReturn["editorDoc"];
  readonly activeDocumentSignal: UseEditorSessionReturn["activeDocumentSignal"];
  readonly editorHandle: MarkdownEditorHandle | null;
  readonly lexicalEditor: LexicalEditor | null;
  readonly headings: HeadingEntry[];
  readonly diagnostics: DiagnosticEntry[];
  readonly editorMode: EditorMode;
  readonly isMarkdownFile: boolean;
  readonly hasDirtyDocument: boolean;
}

export interface AppEditorDocumentQueries {
  readonly getCurrentDocText: UseEditorSessionReturn["getCurrentDocText"];
  readonly peekCurrentDocText: () => string;
  readonly getCurrentSourceMap: UseEditorSessionReturn["getCurrentSourceMap"];
  readonly isPathOpen: UseEditorSessionReturn["isPathOpen"];
  readonly isPathDirty: UseEditorSessionReturn["isPathDirty"];
}

export interface AppEditorFileCommands {
  readonly cancelPendingOpenFile: UseEditorSessionReturn["cancelPendingOpenFile"];
  readonly openFile: UseEditorSessionReturn["openFile"];
  readonly openFileWithContent: UseEditorSessionReturn["openFileWithContent"];
  readonly reloadFile: UseEditorSessionReturn["reloadFile"];
  readonly syncExternalChange: UseEditorSessionReturn["syncExternalChange"];
  readonly saveFile: UseEditorSessionReturn["saveFile"];
  readonly createFile: UseEditorSessionReturn["createFile"];
  readonly createDirectory: UseEditorSessionReturn["createDirectory"];
  readonly closeCurrentFile: UseEditorSessionReturn["closeCurrentFile"];
  readonly handleRename: UseEditorSessionReturn["handleRename"];
  readonly handleDelete: UseEditorSessionReturn["handleDelete"];
  readonly saveAs: UseEditorSessionReturn["saveAs"];
  readonly handleWindowCloseRequest: UseEditorSessionReturn["handleWindowCloseRequest"];
}

export interface AppEditorSurfaceCommands {
  readonly handleDocChange: UseEditorSessionReturn["handleDocChange"];
  readonly handleDirtyChange: UseEditorSessionReturn["markCurrentDocumentDirty"];
  readonly handleProgrammaticDocChange: UseEditorSessionReturn["handleProgrammaticDocChange"];
  readonly setDocumentSourceMap: UseEditorSessionReturn["setDocumentSourceMap"];
  readonly handleHeadingsChange: (headings: HeadingEntry[]) => void;
  readonly handleLexicalEditorReady: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly handleEditorDocumentReady: (docPath: string | undefined) => void;
}

export interface AppEditorNavigationCommands {
  readonly handleOutlineSelect: (from: number) => void;
  readonly handleGotoLine: (line: number, col?: number) => void;
  readonly handleSearchResult: (target: SearchNavigationTarget, onComplete?: () => void) => void;
}

export interface AppEditorEditingCommands {
  readonly handleInsertImage: () => void;
  readonly handleModeChange: (mode: EditorMode) => void;
}

export interface AppEditorImportCommands {
  readonly handleDragOver: (event: React.DragEvent) => void;
  readonly handleDrop: (event: React.DragEvent) => void;
}

export interface AppEditorPluginController {
  readonly manager: EditorPluginManager;
}

export interface AppEditorShellController {
  readonly state: AppEditorDocumentState;
  readonly queries: AppEditorDocumentQueries;
  readonly files: AppEditorFileCommands;
  readonly surface: AppEditorSurfaceCommands;
  readonly navigation: AppEditorNavigationCommands;
  readonly editing: AppEditorEditingCommands;
  readonly imports: AppEditorImportCommands;
  readonly plugins: AppEditorPluginController;
}

export function useAppEditorShell({
  fs,
  settings,
  refreshTree,
  addRecentFile,
  onAfterSave,
  requestUnsavedChangesDecision,
}: AppEditorShellDeps): AppEditorShellController {
  const [pluginManager] = useState(() => new EditorPluginManager(defaultEditorPlugins));
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
    openFile,
    isPathOpen,
    openFileWithContent,
    saveFile: sessionSaveFile,
  } = session;

  const [editorHandle, setEditorHandle] = useState<MarkdownEditorHandle | null>(null);
  const editorHandleRef = useRef<MarkdownEditorHandle | null>(null);
  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const diagnostics = useDiagnostics((s) => s.diagnostics);

  const { runEditorTransaction } = useEditorTransactions({
    currentPath,
    editorDoc,
    editorHandleRef,
    getSessionCurrentDocText,
    handleDocumentSnapshot: session.handleDocumentSnapshot,
  });

  const getDebugCurrentDocText = useCallback(() => {
    return runEditorTransaction("debug-read", getSessionCurrentDocText).value;
  }, [getSessionCurrentDocText, runEditorTransaction]);

  const getSourceSelectionDocText = useCallback(() => {
    return runEditorTransaction("source-selection", getSessionCurrentDocText).value;
  }, [getSessionCurrentDocText, runEditorTransaction]);

  const peekCurrentDocText = useCallback(() => getSessionCurrentDocText(), [getSessionCurrentDocText]);

  const flushEditorDocumentBoundary = useCallback(() => {
    runEditorTransaction("save", () => undefined);
  }, [runEditorTransaction]);

  const saveFile = useCallback(async () => {
    flushEditorDocumentBoundary();
    await Promise.resolve();
    await sessionSaveFile();
  }, [flushEditorDocumentBoundary, sessionSaveFile]);

  const openFileCommand = useCallback(async (path: string) => {
    flushEditorDocumentBoundary();
    await openFile(path);
  }, [flushEditorDocumentBoundary, openFile]);

  const openFileWithContentCommand = useCallback(async (name: string, content: string) => {
    flushEditorDocumentBoundary();
    await openFileWithContent(name, content);
  }, [flushEditorDocumentBoundary, openFileWithContent]);

  const closeCurrentFileCommand = useCallback(async (options?: { discard?: boolean }) => {
    flushEditorDocumentBoundary();
    return session.closeCurrentFile(options);
  }, [flushEditorDocumentBoundary, session]);

  const saveAsCommand = useCallback(async () => {
    flushEditorDocumentBoundary();
    await session.saveAs();
  }, [flushEditorDocumentBoundary, session]);

  const handleWindowCloseRequestCommand = useCallback(async () => {
    flushEditorDocumentBoundary();
    return session.handleWindowCloseRequest();
  }, [flushEditorDocumentBoundary, session]);

  const navigation = useEditorNavigation({
    openFile: openFileCommand,
    isPathOpen,
    currentPath,
    getCurrentDocText: getSourceSelectionDocText,
  });
  const {
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult: handleSearchResultNavigation,
    handleEditorDocumentReady,
    syncHandle,
  } = navigation;

  const handleLexicalEditorReady = useCallback((handle: MarkdownEditorHandle, editor: LexicalEditor) => {
    setEditorHandle(handle);
    editorHandleRef.current = handle;
    lexicalEditorRef.current = editor;
    syncHandle(handle);
  }, [syncHandle]);

  const handleHeadingsChange = useCallback((nextHeadings: HeadingEntry[]) => {
    setHeadings(nextHeadings);
  }, []);

  const handleInsertImage = useCallback(() => {
    const handle = editorHandle;
    if (!handle) {
      return;
    }

    void pickImageAsDataUrl().then((dataUrl) => {
      if (!dataUrl) {
        return;
      }
      handle.insertText(`![](${dataUrl})`);
      handle.focus();
    });
  }, [editorHandle]);

  const isMarkdownFile = currentPath?.endsWith(".md") ?? false;
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
    return normalizeEditorMode(settings.editorMode, isMarkdownFile);
  }, [currentPath, isMarkdownFile, modeOverrides, pendingModeOverride, settings.editorMode]);

  const handleModeChange = useCallback((mode: EditorMode) => {
    const { flush: flushResult } = runEditorTransaction("mode-switch", () => undefined);
    const normalizedMode = normalizeEditorMode(mode, isMarkdownFile);
    const path = currentPath;
    const applyModeOverride = () => {
      if (path) {
        setModeOverrides((previous) => ({
          ...previous,
          [path]: normalizedMode,
        }));
      }
      setPendingModeOverride((previous) =>
        previous?.path === path ? null : previous,
      );
    };
    if (flushResult.shouldDeferModeSwitch) {
      window.setTimeout(applyModeOverride, 0);
    } else {
      applyModeOverride();
    }
  }, [currentPath, isMarkdownFile, runEditorTransaction]);

  const handleSearchResult = useCallback((
    target: SearchNavigationTarget,
    onComplete?: () => void,
  ) => {
    runEditorTransaction("search-navigation", () => undefined);
    const targetIsMarkdown = target.file.endsWith(".md");
    const normalizedMode = normalizeEditorMode(target.editorMode, targetIsMarkdown);
    const requestId = ++pendingModeRequestIdRef.current;
    setPendingModeOverride({
      path: target.file,
      mode: normalizedMode,
      requestId,
    });
    void handleSearchResultNavigation(
      target.file,
      target.pos,
      { focusSelection: normalizedMode === "source" },
      onComplete,
    ).then((opened) => {
      window.setTimeout(() => {
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
        if (normalizedMode === "lexical") {
          dispatchNavigateSourcePositionEvent(target.pos);
        }
      }, 0);
    });
  }, [handleSearchResultNavigation, runEditorTransaction]);

  const hasDirtyDocument = currentDocument?.dirty ?? false;

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    for (const file of files) {
      if (!file.name.endsWith(".md")) {
        continue;
      }
      void file.text().then((text) => {
        openFileWithContentCommand(file.name, text);
      });
    }
  }, [openFileWithContentCommand]);

  return {
    state: {
      currentDocument,
      currentPath,
      editorDoc,
      activeDocumentSignal,
      editorHandle,
      lexicalEditor: lexicalEditorRef.current,
      headings,
      diagnostics,
      editorMode,
      isMarkdownFile,
      hasDirtyDocument,
    },
    queries: {
      getCurrentDocText: getDebugCurrentDocText,
      peekCurrentDocText,
      getCurrentSourceMap: session.getCurrentSourceMap,
      isPathOpen: session.isPathOpen,
      isPathDirty: session.isPathDirty,
    },
    files: {
      cancelPendingOpenFile: session.cancelPendingOpenFile,
      openFile: openFileCommand,
      openFileWithContent: openFileWithContentCommand,
      reloadFile: session.reloadFile,
      syncExternalChange: session.syncExternalChange,
      saveFile,
      createFile: session.createFile,
      createDirectory: session.createDirectory,
      closeCurrentFile: closeCurrentFileCommand,
      handleRename: session.handleRename,
      handleDelete: session.handleDelete,
      saveAs: saveAsCommand,
      handleWindowCloseRequest: handleWindowCloseRequestCommand,
    },
    surface: {
      handleDocChange: session.handleDocChange,
      handleDirtyChange: session.markCurrentDocumentDirty,
      handleProgrammaticDocChange: session.handleProgrammaticDocChange,
      setDocumentSourceMap: session.setDocumentSourceMap,
      handleHeadingsChange,
      handleLexicalEditorReady,
      handleEditorDocumentReady,
    },
    navigation: {
      handleOutlineSelect,
      handleGotoLine,
      handleSearchResult,
    },
    editing: {
      handleInsertImage,
      handleModeChange,
    },
    imports: {
      handleDragOver,
      handleDrop,
    },
    plugins: {
      manager: pluginManager,
    },
  };
}
