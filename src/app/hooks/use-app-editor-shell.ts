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

export interface AppEditorShellController extends UseEditorSessionReturn {
  readonly pluginManager: EditorPluginManager;
  readonly editorHandle: MarkdownEditorHandle | null;
  readonly lexicalEditor: LexicalEditor | null;
  readonly headings: HeadingEntry[];
  readonly diagnostics: DiagnosticEntry[];
  readonly handleHeadingsChange: (headings: HeadingEntry[]) => void;
  readonly handleLexicalEditorReady: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly handleEditorDocumentReady: (docPath: string | undefined) => void;
  readonly handleOutlineSelect: (from: number) => void;
  readonly handleGotoLine: (line: number, col?: number) => void;
  readonly handleSearchResult: (target: SearchNavigationTarget, onComplete?: () => void) => void;
  readonly handleInsertImage: () => void;
  readonly editorMode: EditorMode;
  readonly handleModeChange: (mode: EditorMode) => void;
  readonly isMarkdownFile: boolean;
  readonly hasDirtyDocument: boolean;
  readonly handleDragOver: (event: React.DragEvent) => void;
  readonly handleDrop: (event: React.DragEvent) => void;
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
    activeDocumentSignal,
    getCurrentDocText,
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

  const flushPendingEditorEdits = useCallback(() => {
    editorHandleRef.current?.flushPendingEdits();
  }, []);

  const getFreshCurrentDocText = useCallback(() => {
    flushPendingEditorEdits();
    return getCurrentDocText();
  }, [flushPendingEditorEdits, getCurrentDocText]);

  const saveFile = useCallback(async () => {
    flushPendingEditorEdits();
    await Promise.resolve();
    await sessionSaveFile();
  }, [flushPendingEditorEdits, sessionSaveFile]);

  const navigation = useEditorNavigation({
    openFile,
    isPathOpen,
    currentPath,
    getCurrentDocText: getFreshCurrentDocText,
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
  }, [currentPath, isMarkdownFile]);

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
    void handleSearchResultNavigation(
      target.file,
      target.pos,
      { focusSelection: normalizedMode === "source" },
      onComplete,
    ).then((opened) => {
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
    });
  }, [handleSearchResultNavigation]);

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
        openFileWithContent(file.name, text);
      });
    }
  }, [openFileWithContent]);

  return {
    ...session,
    pluginManager,
    saveFile,
    editorHandle,
    lexicalEditor: lexicalEditorRef.current,
    headings,
    diagnostics,
    handleHeadingsChange,
    handleLexicalEditorReady,
    handleEditorDocumentReady,
    handleOutlineSelect,
    handleGotoLine,
    handleSearchResult,
    handleInsertImage,
    editorMode,
    handleModeChange,
    isMarkdownFile,
    activeDocumentSignal,
    getCurrentDocText: getFreshCurrentDocText,
    hasDirtyDocument,
    handleDragOver,
    handleDrop,
  };
}
