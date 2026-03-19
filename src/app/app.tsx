import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { loadProjectConfig } from "./project-config";
import type { ProjectConfig } from "./project-config";
import { insertImageFromPicker } from "../editor/image-insert";
import type { Tab } from "./tab-bar";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the file name portion of a path (last segment after "/"). */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}


// ── Inner app (has access to FileSystem context) ──────────────────────────────

function AppInner() {
  const fs = useFileSystem();
  const { settings, updateSetting } = useSettings();
  const { theme, setTheme, resolvedTheme } = useTheme(settings.themeName, settings.customCss);
  const { recentFiles, addRecentFile } = useRecentFiles();
  const { windowState, saveState: saveWindowState } = useWindowState();

  // ── Dialog open states ──────────────────────────────────────────────────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gotoLineOpen, setGotoLineOpen] = useState(false);

  // ── Indexer for search ─────────────────────────────────────────────────────
  const [indexer] = useState(() => new BackgroundIndexer());

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

  // ── Tabs & buffers ─────────────────────────────────────────────────────────
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  /** path → raw file content (for FS save) */
  const buffers = useRef<Map<string, string>>(new Map());
  /** path → in-editor doc string (live, may include expanded includes) */
  const liveDocs = useRef<Map<string, string>>(new Map());
  /** Ref mirror of openTabs paths — avoids closing over stale openTabs in openFile. */
  const openPathsRef = useRef<Set<string>>(new Set());
  /** Ref mirror of activeTab — avoids stale closure in handleDocChange. */
  const activeTabRef = useRef<string | null>(null);

  // ── Active document ────────────────────────────────────────────────────────
  /** The doc string passed to EditorPane. Changing this recreates the CM6 editor. */
  const [editorDoc, setEditorDoc] = useState("");

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

  // Track doc changes to mark tab dirty — use ref to avoid stale activeTab closure.
  const handleDocChange = useCallback((doc: string) => {
    const path = activeTabRef.current;
    if (!path) return;
    liveDocs.current.set(path, doc);

    const isDirty = doc !== (buffers.current.get(path) ?? "");
    setOpenTabs((prev) => {
      const tab = prev.find((t) => t.path === path);
      // Guard: skip update when dirty state hasn't changed.
      if (!tab || tab.dirty === isDirty) return prev;
      return prev.map((t) => (t.path === path ? { ...t, dirty: isDirty } : t));
    });
  }, []);

  // Sync ref mirrors whenever state updates.
  useEffect(() => {
    openPathsRef.current = new Set(openTabs.map((t) => t.path));
  }, [openTabs]);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // ── File operations ────────────────────────────────────────────────────────

  const openFile = useCallback(async (path: string) => {
    // If already open, just activate — use ref to avoid capturing openTabs.
    if (openPathsRef.current.has(path)) {
      setActiveTab(path);
      setEditorDoc(liveDocs.current.get(path) ?? buffers.current.get(path) ?? "");
      addRecentFile(path);
      return;
    }

    try {
      const content = await fs.readFile(path);
      buffers.current.set(path, content);
      liveDocs.current.set(path, content);

      setOpenTabs((prev) => [...prev, { path, name: basename(path), dirty: false }]);
      setActiveTab(path);
      setEditorDoc(content);
      addRecentFile(path);
    } catch {
      // Silently ignore unreadable files
    }
  }, [fs, addRecentFile]);

  const saveFile = useCallback(async () => {
    const path = activeTab;
    if (!path) return;

    const doc = liveDocs.current.get(path) ?? "";
    try {
      await fs.writeFile(path, doc);
      buffers.current.set(path, doc);
      setOpenTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)),
      );
    } catch {
      // Save failed — leave dirty
    }
  }, [activeTab, fs]);

  const createFile = useCallback(async (path: string) => {
    try {
      await fs.createFile(path, "");
      await refreshTree();
      await openFile(path);
    } catch {
      // File may already exist
    }
  }, [fs, refreshTree, openFile]);

  const createDirectory = useCallback(async (path: string) => {
    try {
      await fs.createDirectory(path);
      await refreshTree();
    } catch {
      // Directory may already exist
    }
  }, [fs, refreshTree]);

  const closeFile = useCallback(async (path: string) => {
    // Save-before-close: ask if tab is dirty
    const tab = openTabs.find((t) => t.path === path);
    if (tab?.dirty) {
      const answer = window.confirm(
        `"${tab.name}" has unsaved changes.\n\nPress OK to discard, or Cancel to keep editing.`
      );
      if (!answer) return;
    }

    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      return prev.filter((t) => t.path !== path);
    });

    if (path === activeTabRef.current) {
      setTimeout(() => {
        const remaining = openTabs.filter((t) => t.path !== path);
        const nextPath = remaining[0]?.path ?? null;
        setActiveTab(nextPath);
        setEditorDoc(
          nextPath
            ? (liveDocs.current.get(nextPath) ?? buffers.current.get(nextPath) ?? "")
            : "",
        );
      }, 0);
    }

    buffers.current.delete(path);
    liveDocs.current.delete(path);
  }, [openTabs]);

  const switchToTab = useCallback((path: string) => {
    setActiveTab(path);
    setEditorDoc(liveDocs.current.get(path) ?? buffers.current.get(path) ?? "");
  }, []);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    try {
      await fs.renameFile(oldPath, newPath);
      await refreshTree();

      // Move buffer/liveDoc entries to new key
      const content = buffers.current.get(oldPath);
      if (content !== undefined) {
        buffers.current.delete(oldPath);
        buffers.current.set(newPath, content);
      }
      const liveDoc = liveDocs.current.get(oldPath);
      if (liveDoc !== undefined) {
        liveDocs.current.delete(oldPath);
        liveDocs.current.set(newPath, liveDoc);
      }

      setOpenTabs((prev) =>
        prev.map((t) =>
          t.path === oldPath ? { ...t, path: newPath, name: basename(newPath) } : t,
        ),
      );
      if (activeTabRef.current === oldPath) {
        setActiveTab(newPath);
      }
    } catch {
      // Rename failed
    }
  }, [fs, refreshTree]);

  const handleDelete = useCallback(async (path: string) => {
    const ok = window.confirm(`Delete "${basename(path)}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await fs.deleteFile(path);
    } catch {
      // deleteFile may not be supported (e.g., MemoryFS for non-existent files)
    }
    // Close the exact file, or all children if it was a directory (single batch update)
    const prefix = path + "/";
    const isAffected = (p: string) => p === path || p.startsWith(prefix);
    setOpenTabs((prev) => {
      const affected = new Set(prev.filter((t) => isAffected(t.path)).map((t) => t.path));
      if (affected.size === 0) return prev;
      // Clean up buffers/liveDocs for affected paths
      for (const p of affected) {
        buffers.current.delete(p);
        liveDocs.current.delete(p);
      }
      const remaining = prev.filter((t) => !affected.has(t.path));
      // If the active tab was deleted, switch to another
      if (affected.has(activeTabRef.current ?? "")) {
        const nextPath = remaining[0]?.path ?? null;
        setActiveTab(nextPath);
        setEditorDoc(
          nextPath
            ? (liveDocs.current.get(nextPath) ?? buffers.current.get(nextPath) ?? "")
            : "",
        );
      }
      return remaining;
    });
    await refreshTree();
  }, [fs, refreshTree]);

  const handleOutlineSelect = useCallback((from: number) => {
    const view = editorState?.view;
    if (!view) return;
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  }, [editorState?.view]);

  // ── Save As ───────────────────────────────────────────────────────────────
  const saveAs = useCallback(async () => {
    const path = activeTab;
    if (!path) return;
    const doc = liveDocs.current.get(path) ?? "";

    if (isTauri()) {
      // Tauri: open native save dialog
      try {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const savePath = await save({
          defaultPath: path,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (!savePath) return; // user cancelled
        await fs.writeFile(savePath, doc);
        addRecentFile(savePath);
      } catch {
        // Save dialog failed or was cancelled
      }
    } else {
      // Browser: download the file
      const blob = new Blob([doc], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = basename(path);
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [activeTab, fs, addRecentFile]);

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
  }, [activeTab, fs]);

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
    onGoToLine: () => setGotoLineOpen(true),
    onAbout: () => setAboutOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
    onShowSettings: () => setSettingsOpen(true),
    onShowSearch: () => setSearchOpen(true),
    onOpenFolder: handleOpenFolder,
    onOpenRecentFile: (path: string) => { void openFile(path); },
    recentFiles,
    onExportHtml: handleExportHtml,
    onBatchExportHtml: handleBatchExportHtml,
  }), [saveFile, saveAs, activeTab, closeFile, resolvedTheme, setTheme, handleOpenFolder, openFile, recentFiles, handleExportHtml, handleBatchExportHtml]);

  const commands = useCommands(commandHandlers);

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const hasDirtyFiles = openTabs.some((t) => t.dirty);
  useAutoSave(hasDirtyFiles, saveFile, settings.autoSaveInterval);

  // ── Sync enabledPlugins settings → plugin manager ─────────────────────────
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
    { key: "mod+shift+p", handler: () => setPaletteOpen((v) => !v) },
    { key: "mod+shift+f", handler: () => setSearchOpen((v) => !v) },
    { key: "mod+,", handler: () => setSettingsOpen((v) => !v) },
    { key: "mod+/", handler: () => setShortcutsOpen((v) => !v) },
    { key: "mod+g", handler: () => setGotoLineOpen((v) => !v) },
    { key: "mod+b", handler: () => setSidebarCollapsed((v) => !v) },
  ]);

  // ── Native menu bar events (Tauri only) ────────────────────────────────────
  useMenuEvents({
    onSave: () => { void saveFile(); },
    onSaveAs: () => { void saveAs(); },
    onCloseTab: () => { if (activeTab) void closeFile(activeTab); },
    onToggleSidebar: () => setSidebarCollapsed((v) => !v),
    onShowSearch: () => setSearchOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
    onAbout: () => setAboutOpen(true),
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
    setGotoLineOpen(false);
  }, [editorState?.view]);

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
    setSearchOpen(false);
  }, [openFile, editorState?.view]);

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
          onOpenPalette={() => setPaletteOpen(true)}
          docText={docTextForStats}
        />
      </div>

      {/* ── Overlays & Dialogs ────────────────────────────────────────────── */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
      />
      <SearchPanel
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onResultSelect={handleSearchResult}
        indexer={indexer}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onUpdateSetting={updateSetting}
        theme={theme}
        onSetTheme={setTheme}
        plugins={pluginManager.getPlugins()}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <GotoLineDialog
        open={gotoLineOpen}
        onOpenChange={setGotoLineOpen}
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
