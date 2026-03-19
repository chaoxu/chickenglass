import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { loadProjectConfig } from "./project-config";
import type { ProjectConfig } from "./project-config";
import { insertImageFromPicker } from "../editor/image-insert";
import { TabBar } from "./components/tab-bar";
import { Sidebar } from "./components/sidebar";
import { FileTree } from "./components/file-tree";
import { Outline } from "./components/outline";
import { EditorPane } from "./components/editor-pane";
import { StatusBar } from "./components/status-bar";
import { CommandPalette } from "./components/command-palette";
import { SearchPanel } from "./components/search-panel";
import { SettingsDialog } from "./components/settings-dialog";
import { AboutDialog } from "./components/about-dialog";
import { ShortcutsDialog } from "./components/shortcuts-dialog";
import { GotoLineDialog } from "./components/goto-line-dialog";
// Breadcrumbs needs editor scroll position — TODO wire once EditorPane exposes scrollTop
import { SymbolPanel } from "./components/symbol-panel";
import { useTheme } from "./hooks/use-theme";
import { useSettings } from "./hooks/use-settings";
import { useCommands } from "./hooks/use-commands";
import { useAutoSave } from "./hooks/use-auto-save";
import { useHotkeys } from "./hooks/use-hotkeys";
import { useRecentFiles } from "./hooks/use-recent-files";
import { useWindowState } from "./hooks/use-window-state";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useDialogs } from "./hooks/use-dialogs";
import { useDocumentBuffer } from "./hooks/use-document-buffer";
import { useFileOperations } from "./hooks/use-file-operations";
import type { UseEditorReturn } from "./hooks/use-editor";
import type { FileEntry } from "./file-manager";
import { BackgroundIndexer } from "../index";
import { extractHeadings, type HeadingEntry } from "./heading-ancestry";
import type { EditorMode } from "../editor";
import { setEditorMode } from "../editor";
import { EditorPluginManager } from "../editor/editor-plugin";
import { defaultEditorPlugins } from "../editor/editor-plugins-registry";
import { isTauri, openFolder as tauriOpenFolder } from "./tauri-fs";
import { exportDocument, batchExport } from "./export";


// ── Inner app (has access to FileSystem context) ──────────────────────────────

function AppInner() {
  const fs = useFileSystem();
  const { settings, updateSetting } = useSettings();
  const { theme, setTheme, resolvedTheme } = useTheme(settings.themeName, settings.customCss);
  const { recentFiles, addRecentFile } = useRecentFiles();
  const { windowState, saveState: saveWindowState } = useWindowState();

  // ── Dialog open states (extracted to useDialogs) ──────────────────────────
  const dialogs = useDialogs();

  // ── Indexer for search ─────────────────────────────────────────────────────
  const [indexer] = useState(() => new BackgroundIndexer());

  // Terminate the indexer web worker on unmount to prevent resource leaks.
  useEffect(() => {
    return () => {
      indexer.dispose();
    };
  }, [indexer]);

  // ── Plugin manager (shared across editor recreations) ───────────────────
  const [pluginManager] = useState(() => {
    const m = new EditorPluginManager();
    defaultEditorPlugins.forEach((p) => m.register(p));
    return m;
  });

  // ── File tree ──────────────────────────────────────────────────────────────
  const [fileTree, setFileTree] = useState<FileEntry | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<"files" | "outline" | "symbols">("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(false);

  const refreshTree = useCallback(async () => {
    try {
      const tree = await fs.listTree();
      setFileTree(tree);
    } catch {
      // Filesystem may not support listTree (e.g. empty MemoryFS) — show no tree
      setFileTree(null);
    }
  }, [fs]);

  // Load tree + project config on mount
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});
  useEffect(() => {
    void refreshTree();
    void loadProjectConfig(fs).then(setProjectConfig);
  }, [fs, refreshTree]);

  // ── Document buffer (tabs, buffers, liveDocs — extracted to useDocumentBuffer) ─
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

  // ── Active document ────────────────────────────────────────────────────────
  // ── Editor state (view, wordCount, cursorPos) ─────────────────────────────
  const [editorState, setEditorState] = useState<UseEditorReturn | null>(null);

  // ── Outline headings ───────────────────────────────────────────────────────
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);

    // Extract headings from current CM6 view
    if (state.view) {
      setHeadings(extractHeadings(state.view.state));
    } else {
      setHeadings([]);
    }
  }, []);

  // ── File operations (extracted to useFileOperations) ──────────────────────
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
    saveFile,
    createFile,
    createDirectory,
    closeFile,
    handleRename,
    handleDelete,
    saveAs,
  } = fileOps;

  const handleOutlineSelect = useCallback((from: number) => {
    const view = editorState?.view;
    if (!view) return;
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  }, [editorState?.view]);

  // ── Open Folder ───────────────────────────────────────────────────────────
  const handleOpenFolder = useCallback(() => {
    if (!isTauri()) return;
    void tauriOpenFolder().then((folderPath) => {
      if (folderPath) {
        void refreshTree();
      }
    });
  }, [refreshTree]);

  // ── Window state persistence ──────────────────────────────────────────────
  // Save window state whenever tabs or sidebar state changes.
  useEffect(() => {
    saveWindowState({
      tabs: openTabs.map((t) => ({ path: t.path, name: t.name })),
      activeTab,
    });
  }, [openTabs, activeTab, saveWindowState]);

  useEffect(() => {
    saveWindowState({ sidebarWidth: sidebarCollapsed ? 0 : sidebarWidth });
  }, [sidebarCollapsed, sidebarWidth, saveWindowState]);

  // ── Export handlers ──────────────────────────────────────────────────────
  const handleExportHtml = useCallback(() => {
    if (!activeTab) return;
    const doc = liveDocs.current.get(activeTab) ?? "";
    void exportDocument(doc, "html", activeTab, fs).then(
      (outputPath) => {
        window.alert(`Exported to ${outputPath}`);
      },
      (err: unknown) => {
        window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }, [activeTab, fs, liveDocs]);

  const handleBatchExportHtml = useCallback(() => {
    if (!fileTree) return;
    void (async () => {
      const results = await batchExport(fileTree, "html", fs);
      const succeeded = results.filter((r) => r.outputPath);
      const failed = results.filter((r) => r.error);
      const summary = [`Batch export complete: ${succeeded.length} succeeded`];
      if (failed.length > 0) {
        summary.push(`${failed.length} failed`);
        for (const f of failed) {
          summary.push(`  ${f.path}: ${f.error}`);
        }
      }
      window.alert(summary.join("\n"));
    })();
  }, [fileTree, fs]);

  // ── Command palette commands ──────────────────────────────────────────────
  const commandHandlers = useMemo(() => ({
    onSave: () => { void saveFile(); },
    onSaveAs: () => { void saveAs(); },
    onCloseTab: () => { if (activeTab) void closeFile(activeTab); },
    onToggleSidebar: () => setSidebarCollapsed((v) => !v),
    onToggleSidenotes: () => setSidenotesCollapsed((v) => !v),
    onInsertImage: () => {
      const view = editorState?.view;
      if (view) void insertImageFromPicker(view, editorState?.imageSaver ?? undefined);
    },
    onShowFiles: () => { setSidebarCollapsed(false); setSidebarTab("files"); },
    onShowOutline: () => { setSidebarCollapsed(false); setSidebarTab("outline"); },
    onToggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    onGoToLine: () => dialogs.setGotoLineOpen(true),
    onAbout: () => dialogs.setAboutOpen(true),
    onShowShortcuts: () => dialogs.setShortcutsOpen(true),
    onShowSettings: () => dialogs.setSettingsOpen(true),
    onShowSearch: () => dialogs.setSearchOpen(true),
    onOpenFolder: handleOpenFolder,
    onOpenRecentFile: (path: string) => { void openFile(path); },
    recentFiles,
    onExportHtml: handleExportHtml,
    onBatchExportHtml: handleBatchExportHtml,
  }), [saveFile, saveAs, activeTab, closeFile, resolvedTheme, setTheme, handleOpenFolder, openFile, recentFiles, handleExportHtml, handleBatchExportHtml, dialogs, editorState?.view, editorState?.imageSaver]);

  const commands = useCommands(commandHandlers);

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const hasDirtyFiles = openTabs.some((t) => t.dirty);
  useAutoSave(hasDirtyFiles, saveFile, settings.autoSaveInterval);

  // ── Sync enabledPlugins settings -> plugin manager ─────────────────────────
  useEffect(() => {
    const view = editorState?.view ?? null;
    for (const { plugin, enabled } of pluginManager.getPlugins()) {
      const settingEnabled = settings.enabledPlugins[plugin.id];
      // Only override if the setting explicitly specifies (not undefined)
      if (settingEnabled !== undefined && settingEnabled !== enabled) {
        pluginManager.setEnabled(view, plugin.id, settingEnabled);
      }
    }
  }, [settings.enabledPlugins, editorState?.view, pluginManager]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useHotkeys([
    { key: "mod+s", handler: () => { void saveFile(); } },
    { key: "mod+shift+s", handler: () => { void saveAs(); } },
    { key: "mod+shift+p", handler: () => dialogs.setPaletteOpen((v) => !v) },
    { key: "mod+shift+f", handler: () => dialogs.setSearchOpen((v) => !v) },
    { key: "mod+,", handler: () => dialogs.setSettingsOpen((v) => !v) },
    { key: "mod+/", handler: () => dialogs.setShortcutsOpen((v) => !v) },
    { key: "mod+g", handler: () => dialogs.setGotoLineOpen((v) => !v) },
    { key: "mod+b", handler: () => setSidebarCollapsed((v) => !v) },
  ]);

  // ── Native menu bar events (Tauri only) ────────────────────────────────────
  useMenuEvents({
    onSave: () => { void saveFile(); },
    onSaveAs: () => { void saveAs(); },
    onCloseTab: () => { if (activeTab) void closeFile(activeTab); },
    onToggleSidebar: () => setSidebarCollapsed((v) => !v),
    onShowSearch: () => dialogs.setSearchOpen(true),
    onShowShortcuts: () => dialogs.setShortcutsOpen(true),
    onAbout: () => dialogs.setAboutOpen(true),
    onOpenFolder: handleOpenFolder,
  });

  // ── Go to line handler ─────────────────────────────────────────────────────
  const handleGotoLine = useCallback((line: number, col?: number) => {
    const view = editorState?.view;
    if (!view) return;
    const docLine = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    const offset = docLine.from + (col ? col - 1 : 0);
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
    dialogs.setGotoLineOpen(false);
  }, [editorState?.view, dialogs]);

  // ── Search result handler ──────────────────────────────────────────────────
  const handleSearchResult = useCallback((file: string, pos: number) => {
    void openFile(file).then(() => {
      setTimeout(() => {
        const view = editorState?.view;
        if (view) {
          view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
          view.focus();
        }
      }, 100);
    });
    dialogs.setSearchOpen(false);
  }, [openFile, editorState?.view, dialogs]);

  // ── Symbol insert handler ──────────────────────────────────────────────────
  const handleSymbolInsert = useCallback((latex: string) => {
    const view = editorState?.view;
    if (!view) return;
    const { from } = view.state.selection.main;
    view.dispatch({ changes: { from, insert: latex } });
    view.focus();
  }, [editorState?.view]);

  // ── Open first file on init (restore from window state or pick default) ───
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !fileTree) return;
    didInitRef.current = true;

    // Try to restore tabs from persisted window state.
    if (windowState.tabs.length > 0) {
      const restoreTabs = async () => {
        for (const tab of windowState.tabs) {
          await openFile(tab.path).catch(() => {
            // File may have been deleted since last session — skip.
          });
        }
        // Activate the previously active tab if it was restored.
        if (windowState.activeTab) {
          const restored = openPathsRef.current.has(windowState.activeTab);
          if (restored) {
            setActiveTab(windowState.activeTab);
            setEditorDoc(
              liveDocs.current.get(windowState.activeTab)
              ?? buffers.current.get(windowState.activeTab)
              ?? "",
            );
          }
        }
      };
      void restoreTabs();

      // Restore sidebar collapsed state and width.
      if (windowState.sidebarWidth === 0) {
        setSidebarCollapsed(true);
      } else if (windowState.sidebarWidth > 0) {
        setSidebarWidth(windowState.sidebarWidth);
      }
      return;
    }

    // No saved state — pick a default file.
    // Prefer main.md or index.md at root, then any root-level .md file,
    // then fall back to depth-first search.
    const rootFiles = (fileTree.children ?? []).filter((c) => !c.isDirectory);
    const preferred = rootFiles.find((f) => f.path === "main.md")
      ?? rootFiles.find((f) => f.path === "index.md")
      ?? rootFiles.find((f) => f.path.endsWith(".md"));

    const findFirst = (entry: FileEntry): string | null => {
      if (!entry.isDirectory) return entry.path;
      for (const child of entry.children ?? []) {
        const found = findFirst(child);
        if (found) return found;
      }
      return null;
    };

    const first = preferred?.path ?? findFirst(fileTree);
    if (first) void openFile(first);
  }, [fileTree, openFile]); // windowState is intentionally omitted — only read on first mount

  // ── Editor mode ────────────────────────────────────────────────────────────
  const [editorMode, setEditorModeState] = useState<EditorMode>("rendered");

  // Reset mode indicator to "rendered" whenever the active file changes so the
  // status bar stays in sync with the freshly-created CM view (which always
  // initialises in rendered mode).
  useEffect(() => {
    setEditorModeState("rendered");
  }, [activeTab]);

  const handleModeChange = useCallback((mode: EditorMode) => {
    setEditorModeState(mode);
    const view = editorState?.view;
    if (view) {
      setEditorMode(view, mode);
    }
  }, [editorState?.view]);

  // ── Status bar info ────────────────────────────────────────────────────────
  const wordCount = editorState?.wordCount ?? 0;
  const cursorCharOffset = editorState?.cursorPos ?? 0;

  // Compute line/col from the char offset using the live CM view.
  const cursorLineCol = (() => {
    const view = editorState?.view;
    if (!view) return { line: 1, col: 1 };
    try {
      const line = view.state.doc.lineAt(cursorCharOffset);
      return { line: line.number, col: cursorCharOffset - line.from + 1 };
    } catch {
      // Offset may be stale (beyond doc length) after a doc swap — fall back to 1:1
      return { line: 1, col: 1 };
    }
  })();

  // Current document text for stats popover (from liveDocs).
  const docTextForStats = activeTab ? (liveDocs.current.get(activeTab) ?? "") : "";

  // ── Drag-and-drop ───────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.name.endsWith(".md")) {
        // Read .md file and open it
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            void openFile(file.name);
          }
        };
        reader.readAsText(file);
      }
    }
  }, [openFile]);

  return (
    <div className="flex h-screen overflow-hidden" onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} width={sidebarWidth} onWidthChange={setSidebarWidth}>
        {/* Tab switcher */}
        <div className="flex border-b border-[var(--cg-border)] shrink-0">
          <button
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-[var(--cg-transition,0.15s)]",
              sidebarTab === "files"
                ? "text-[var(--cg-fg)] border-b-2 border-[var(--cg-accent)]"
                : "text-[var(--cg-muted)] hover:text-[var(--cg-fg)]",
            ].join(" ")}
            onClick={() => setSidebarTab("files")}
          >
            Files
          </button>
          <button
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-[var(--cg-transition,0.15s)]",
              sidebarTab === "outline"
                ? "text-[var(--cg-fg)] border-b-2 border-[var(--cg-accent)]"
                : "text-[var(--cg-muted)] hover:text-[var(--cg-fg)]",
            ].join(" ")}
            onClick={() => setSidebarTab("outline")}
          >
            Outline
          </button>
          <button
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-[var(--cg-transition,0.15s)]",
              sidebarTab === "symbols"
                ? "text-[var(--cg-fg)] border-b-2 border-[var(--cg-accent)]"
                : "text-[var(--cg-muted)] hover:text-[var(--cg-fg)]",
            ].join(" ")}
            onClick={() => setSidebarTab("symbols")}
          >
            Symbols
          </button>
        </div>

        {sidebarTab === "files" && (
          <FileTree
            root={fileTree}
            activePath={activeTab}
            onSelect={(path) => { void openFile(path); }}
            onRename={handleRename}
            onDelete={handleDelete}
            onCreateFile={(path) => { void createFile(path); }}
            onCreateDir={(path) => { void createDirectory(path); }}
          />
        )}
        {sidebarTab === "outline" && (
          <Outline headings={headings} onSelect={handleOutlineSelect} />
        )}
        {sidebarTab === "symbols" && (
          <SymbolPanel onInsert={handleSymbolInsert} view={editorState?.view ?? null} />
        )}
      </Sidebar>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab bar */}
        <TabBar
          tabs={openTabs}
          activeTab={activeTab}
          onSelect={switchToTab}
          onClose={closeFile}
          onReorder={setOpenTabs}
        />

        {/* Editor */}
        {activeTab ? (
          <EditorPane
            key={activeTab}
            doc={editorDoc}
            docPath={activeTab}
            projectConfig={projectConfig}
            theme={resolvedTheme}
            fs={fs}
            pluginManager={pluginManager}
            sidenotesCollapsed={sidenotesCollapsed}
            onSidenotesCollapsedChange={setSidenotesCollapsed}
            onDocChange={handleDocChange}
            onStateChange={handleEditorStateChange}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--cg-muted)] text-sm select-none">
            Open a file to start editing
          </div>
        )}

        {/* Status bar */}
        <StatusBar
          wordCount={wordCount}
          cursorPos={cursorLineCol}
          editorMode={editorMode}
          onModeChange={handleModeChange}
          onOpenPalette={() => dialogs.setPaletteOpen(true)}
          docText={docTextForStats}
        />
      </div>

      {/* ── Overlays & Dialogs ────────────────────────────────────────────── */}
      <CommandPalette
        open={dialogs.paletteOpen}
        onOpenChange={dialogs.setPaletteOpen}
        commands={commands}
      />
      <SearchPanel
        open={dialogs.searchOpen}
        onOpenChange={dialogs.setSearchOpen}
        onResultSelect={handleSearchResult}
        indexer={indexer}
      />
      <SettingsDialog
        open={dialogs.settingsOpen}
        onOpenChange={dialogs.setSettingsOpen}
        settings={settings}
        onUpdateSetting={updateSetting}
        theme={theme}
        onSetTheme={setTheme}
        plugins={pluginManager.getPlugins()}
      />
      <AboutDialog open={dialogs.aboutOpen} onClose={dialogs.closeAbout} />
      <ShortcutsDialog open={dialogs.shortcutsOpen} onClose={dialogs.closeShortcuts} />
      <GotoLineDialog
        open={dialogs.gotoLineOpen}
        onOpenChange={dialogs.setGotoLineOpen}
        onGoto={handleGotoLine}
        currentLine={cursorLineCol.line}
      />
    </div>
  );
}

// ── AppShell (public export) ──────────────────────────────────────────────────

interface AppShellProps {
  fs: FileSystem;
}

export function AppShell({ fs }: AppShellProps) {
  return (
    <FileSystemProvider value={fs}>
      <AppInner />
    </FileSystemProvider>
  );
}
