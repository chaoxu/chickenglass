import { useState, useEffect, useCallback, useRef } from "react";
import { FileSystemProvider, useFileSystem } from "./contexts/file-system-context";
import type { FileSystem } from "./file-manager";
import { loadProjectConfig } from "./project-config";
import type { ProjectConfig } from "./project-config";
import type { Tab } from "./tab-bar";
import { TabBar } from "./components/tab-bar";
import { Sidebar } from "./components/sidebar";
import { FileTree } from "./components/file-tree";
import { Outline } from "./components/outline";
import { EditorPane } from "./components/editor-pane";
import { StatusBar } from "./components/status-bar";
import { useTheme } from "./hooks/use-theme";
import type { UseEditorReturn } from "./hooks/use-editor";
import type { FileEntry } from "./file-manager";
import { extractHeadings } from "./heading-ancestry";
import type { EditorMode } from "../editor";
import { setEditorMode } from "../editor";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the file name portion of a path (last segment after "/"). */
function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Whether we're running on macOS. Computed once — never changes at runtime. */
const isMac = navigator.platform.toLowerCase().startsWith("mac");

// ── Inner app (has access to FileSystem context) ──────────────────────────────

function AppInner() {
  const fs = useFileSystem();
  const { resolvedTheme } = useTheme();

  // ── File tree ──────────────────────────────────────────────────────────────
  const [fileTree, setFileTree] = useState<FileEntry | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"files" | "outline">("files");

  const refreshTree = useCallback(async () => {
    try {
      const tree = await fs.listTree();
      setFileTree(tree);
    } catch {
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
  const [headings, setHeadings] = useState<Array<{ level: number; text: string; from: number }>>([]);

  const handleEditorStateChange = useCallback((state: UseEditorReturn) => {
    setEditorState(state);

    // Extract headings from current CM6 view
    if (state.view) {
      const extracted = extractHeadings(state.view.state);
      setHeadings(extracted.map((h) => ({ level: h.level, text: h.text, from: h.pos })));
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
      return;
    }

    try {
      const content = await fs.readFile(path);
      buffers.current.set(path, content);
      liveDocs.current.set(path, content);

      setOpenTabs((prev) => [...prev, { path, name: basename(path), dirty: false }]);
      setActiveTab(path);
      setEditorDoc(content);
    } catch {
      // Silently ignore unreadable files
    }
  }, [fs]);

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

  const closeFile = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      return prev.filter((t) => t.path !== path);
    });

    // Side effects OUTSIDE the updater to avoid infinite re-render loop.
    if (path === activeTabRef.current) {
      // Read the current tabs to find the next one — use a timeout to
      // let React flush the setOpenTabs first.
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
    closeFile(path);
    // FileSystem interface does not yet expose deleteFile — just refresh the tree.
    await refreshTree();
  }, [closeFile, refreshTree]);

  const handleOutlineSelect = useCallback((from: number) => {
    const view = editorState?.view;
    if (!view) return;
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  }, [editorState?.view]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === "s") {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveFile]);

  // ── Open first file on init ────────────────────────────────────────────────
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !fileTree) return;
    didInitRef.current = true;

    // Find first non-directory entry in tree (depth-first)
    const findFirst = (entry: FileEntry): string | null => {
      if (!entry.isDirectory) return entry.path;
      for (const child of entry.children ?? []) {
        const found = findFirst(child);
        if (found) return found;
      }
      return null;
    };

    const first = findFirst(fileTree);
    if (first) void openFile(first);
  }, [fileTree, openFile]);

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
      return { line: 1, col: 1 };
    }
  })();

  // Current document text for stats popover (from liveDocs).
  const docTextForStats = activeTab ? (liveDocs.current.get(activeTab) ?? "") : "";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)}>
        {/* Tab switcher */}
        <div className="flex border-b border-[var(--cg-border)] shrink-0">
          <button
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide",
              sidebarTab === "files"
                ? "text-[var(--cg-fg)] border-b-2 border-[var(--cg-accent,#4a9eff)]"
                : "text-[var(--cg-muted)] hover:text-[var(--cg-fg)]",
            ].join(" ")}
            onClick={() => setSidebarTab("files")}
          >
            Files
          </button>
          <button
            className={[
              "flex-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide",
              sidebarTab === "outline"
                ? "text-[var(--cg-fg)] border-b-2 border-[var(--cg-accent,#4a9eff)]"
                : "text-[var(--cg-muted)] hover:text-[var(--cg-fg)]",
            ].join(" ")}
            onClick={() => setSidebarTab("outline")}
          >
            Outline
          </button>
        </div>

        {sidebarTab === "files" ? (
          <FileTree
            root={fileTree}
            activePath={activeTab}
            onSelect={(path) => { void openFile(path); }}
            onRename={handleRename}
            onDelete={handleDelete}
            onCreateFile={(path) => { void createFile(path); }}
            onCreateDir={(path) => { void createDirectory(path); }}
          />
        ) : (
          <Outline headings={headings} onSelect={handleOutlineSelect} />
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
          docText={docTextForStats}
        />
      </div>
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
