import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { insertImageFromPicker } from "../../editor/image-insert";
import type { EditorMode } from "../../editor";
import {
  setEditorMode,
  wordWrapCompartment,
  lineNumbersCompartment,
  tabSizeCompartment,
  tabSizeExtension,
} from "../../editor";
import { EditorView, lineNumbers } from "@codemirror/view";
import { defaultEditorPlugins } from "../../editor/editor-plugins-registry";
import { EditorPluginManager } from "../../editor/editor-plugin";
import type { UseEditorReturn } from "./use-editor";
import { useEditorSession } from "./use-editor-session";
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
  openTabs: ReturnType<typeof useEditorSession>["openTabs"];
  activeTab: ReturnType<typeof useEditorSession>["activeTab"];
  editorDoc: ReturnType<typeof useEditorSession>["editorDoc"];
  setEditorDoc: ReturnType<typeof useEditorSession>["setEditorDoc"];
  buffers: ReturnType<typeof useEditorSession>["buffers"];
  liveDocs: ReturnType<typeof useEditorSession>["liveDocs"];
  isPathOpen: ReturnType<typeof useEditorSession>["isPathOpen"];
  openFile: ReturnType<typeof useEditorSession>["openFile"];
  openFileWithContent: ReturnType<typeof useEditorSession>["openFileWithContent"];
  reorderTabs: ReturnType<typeof useEditorSession>["reorderTabs"];
  saveFile: ReturnType<typeof useEditorSession>["saveFile"];
  createFile: ReturnType<typeof useEditorSession>["createFile"];
  createDirectory: ReturnType<typeof useEditorSession>["createDirectory"];
  closeFile: ReturnType<typeof useEditorSession>["closeFile"];
  handleRename: ReturnType<typeof useEditorSession>["handleRename"];
  handleDelete: ReturnType<typeof useEditorSession>["handleDelete"];
  saveAs: ReturnType<typeof useEditorSession>["saveAs"];
  pinTab: ReturnType<typeof useEditorSession>["pinTab"];
  switchToTab: ReturnType<typeof useEditorSession>["switchToTab"];
  handleDocChange: ReturnType<typeof useEditorSession>["handleDocChange"];
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
    void openFile(file).then(() => {
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
    }).catch((e: unknown) => {
      console.error("[editor] handleSearchResult: failed to open file", file, e);
    });
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
      void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
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
