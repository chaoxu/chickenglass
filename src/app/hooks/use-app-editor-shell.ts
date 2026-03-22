import { useState, useEffect, useCallback, useMemo } from "react";
import { insertImageFromPicker } from "../../editor/image-insert";
import type { EditorMode } from "../../editor";
import { setEditorMode } from "../../editor";
import { defaultEditorPlugins } from "../../editor/editor-plugins-registry";
import { EditorPluginManager } from "../../editor/editor-plugin";
import type { UseEditorReturn } from "./use-editor";
import { useDocumentBuffer } from "./use-document-buffer";
import { useFileOperations } from "./use-file-operations";
import type { FileSystem } from "../file-manager";
import { extractHeadings, type HeadingEntry } from "../heading-ancestry";
import type { Settings } from "../lib/types";

export interface AppEditorShellDeps {
  fs: FileSystem;
  settings: Settings;
  refreshTree: () => Promise<void>;
  addRecentFile: (path: string) => void;
}

export interface AppEditorShellController {
  pluginManager: EditorPluginManager;
  openTabs: ReturnType<typeof useDocumentBuffer>["openTabs"];
  setOpenTabs: ReturnType<typeof useDocumentBuffer>["setOpenTabs"];
  activeTab: ReturnType<typeof useDocumentBuffer>["activeTab"];
  setActiveTab: ReturnType<typeof useDocumentBuffer>["setActiveTab"];
  editorDoc: ReturnType<typeof useDocumentBuffer>["editorDoc"];
  setEditorDoc: ReturnType<typeof useDocumentBuffer>["setEditorDoc"];
  buffers: ReturnType<typeof useDocumentBuffer>["buffers"];
  liveDocs: ReturnType<typeof useDocumentBuffer>["liveDocs"];
  openPathsRef: ReturnType<typeof useDocumentBuffer>["openPathsRef"];
  openFile: ReturnType<typeof useFileOperations>["openFile"];
  openFileWithContent: ReturnType<typeof useFileOperations>["openFileWithContent"];
  saveFile: ReturnType<typeof useFileOperations>["saveFile"];
  createFile: ReturnType<typeof useFileOperations>["createFile"];
  createDirectory: ReturnType<typeof useFileOperations>["createDirectory"];
  closeFile: ReturnType<typeof useFileOperations>["closeFile"];
  handleRename: ReturnType<typeof useFileOperations>["handleRename"];
  handleDelete: ReturnType<typeof useFileOperations>["handleDelete"];
  saveAs: ReturnType<typeof useFileOperations>["saveAs"];
  pinTab: ReturnType<typeof useFileOperations>["pinTab"];
  switchToTab: ReturnType<typeof useDocumentBuffer>["switchToTab"];
  handleDocChange: ReturnType<typeof useDocumentBuffer>["handleDocChange"];
  editorState: UseEditorReturn | null;
  headings: HeadingEntry[];
  handleEditorStateChange: (state: UseEditorReturn) => void;
  handleOutlineSelect: (from: number) => void;
  handleGotoLine: (line: number, col?: number) => void;
  handleSearchResult: (file: string, pos: number, onComplete?: () => void) => void;
  handleSymbolInsert: (latex: string) => void;
  handleInsertImage: () => void;
  editorMode: EditorMode;
  handleModeChange: (mode: EditorMode) => void;
  isMarkdownFile: boolean;
  wordCount: number;
  cursorLineCol: { line: number; col: number };
  docTextForStats: string;
  hasDirtyFiles: boolean;
  handleDragOver: (e: React.DragEvent) => void;
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

  const docBuffer = useDocumentBuffer();
  const {
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    openPathsRef,
    activeTabRef,
    handleDocChange,
    switchToTab,
    renameBuffers,
  } = docBuffer;

  const fileOps = useFileOperations({
    fs,
    openPathsRef,
    activeTabRef,
    buffers,
    liveDocs,
    openTabs,
    setOpenTabs,
    setActiveTab,
    setEditorDoc,
    renameBuffers,
    refreshTree,
    addRecentFile,
  });

  const {
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
  } = fileOps;

  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);

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
    void openFile(file).then(() => {
      setTimeout(() => {
        const view = editorState?.view;
        if (view) {
          view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
          view.focus();
        }
        onComplete?.();
      }, 100);
    });
  }, [openFile, editorState?.view]);

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
      void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
    }
  }, [editorState?.view, editorState?.imageSaver]);

  const [editorMode, setEditorModeState] = useState<EditorMode>("rich");
  const isMarkdownFile = activeTab?.endsWith(".md") ?? false;

  useEffect(() => {
    setEditorModeState(isMarkdownFile ? "rich" : "source");
  }, [activeTab, isMarkdownFile]);

  useEffect(() => {
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, isMarkdownFile ? "rich" : "source");
  }, [editorState?.view, isMarkdownFile]);

  const handleModeChange = useCallback((mode: EditorMode) => {
    setEditorModeState(mode);
    const view = editorState?.view;
    if (!view) return;
    setEditorMode(view, mode);
  }, [editorState?.view]);

  const wordCount = editorState?.wordCount ?? 0;
  const cursorCharOffset = editorState?.cursorPos ?? 0;

  const cursorLineCol = useMemo(() => {
    const view = editorState?.view;
    if (!view) return { line: 1, col: 1 };
    try {
      const line = view.state.doc.lineAt(cursorCharOffset);
      return { line: line.number, col: cursorCharOffset - line.from + 1 };
    } catch {
      return { line: 1, col: 1 };
    }
  }, [editorState?.view, cursorCharOffset]);

  const docTextForStats = activeTab ? (liveDocs.current.get(activeTab) ?? "") : "";
  const hasDirtyFiles = openTabs.some((tab) => tab.dirty);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.name.endsWith(".md")) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            openFileWithContent(file.name, reader.result);
          }
        };
        reader.readAsText(file);
      }
    }
  }, [openFileWithContent]);

  return {
    pluginManager,
    openTabs,
    setOpenTabs,
    activeTab,
    setActiveTab,
    editorDoc,
    setEditorDoc,
    buffers,
    liveDocs,
    openPathsRef,
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
