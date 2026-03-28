import { useState, useEffect, useCallback, useRef } from "react";
import type { FileEntry, FileSystem } from "../file-manager";
import type { GitStatusMap } from "../tauri-client/git";
import { loadProjectConfig } from "../project-config";
import type { ProjectConfig } from "../project-config";
import { useRecentFiles } from "./use-recent-files";
import { useSettings } from "./use-settings";
import { useTheme } from "./use-theme";
import { useWindowState } from "./use-window-state";
import { measureAsync, withPerfOperation } from "../perf";
import { isTauri } from "../../lib/tauri";

// Lazy-loaded to keep tauri-fs out of the browser startup chunk (#446).
// Other modules already dynamically import tauri-fs; this static import
// was the only thing preventing Vite from code-splitting it.
const tauriFs = () => import("../tauri-fs");

/**
 * Immutably merge loaded children into a tree at `dirPath`.
 *
 * Only merges when the target directory's children are still `undefined`
 * (not yet loaded). This prevents a late `listChildren` response from
 * overwriting a fully-populated subtree that arrived via `listTree`.
 *
 * Returns the same reference when nothing changed, so React state updates
 * can skip re-renders.
 */
export function mergeChildrenIntoTree(
  tree: FileEntry,
  dirPath: string,
  children: FileEntry[],
): FileEntry {
  if (tree.path === dirPath) {
    if (tree.children !== undefined) return tree;
    return { ...tree, children };
  }
  if (!tree.children) return tree;
  let changed = false;
  const mapped = tree.children.map((child) => {
    if (!child.isDirectory) return child;
    if (child.path !== dirPath && !dirPath.startsWith(child.path + "/")) return child;
    const merged = mergeChildrenIntoTree(child, dirPath, children);
    if (merged !== child) changed = true;
    return merged;
  });
  return changed ? { ...tree, children: mapped } : tree;
}

export type SidebarTab = "files" | "outline" | "symbols";

export interface AppWorkspaceSessionController {
  settings: ReturnType<typeof useSettings>["settings"];
  updateSetting: ReturnType<typeof useSettings>["updateSetting"];
  theme: ReturnType<typeof useTheme>["theme"];
  setTheme: ReturnType<typeof useTheme>["setTheme"];
  resolvedTheme: ReturnType<typeof useTheme>["resolvedTheme"];
  projectRoot: string | null;
  recentFiles: ReturnType<typeof useRecentFiles>["recentFiles"];
  recentFolders: ReturnType<typeof useRecentFiles>["recentFolders"];
  addRecentFile: ReturnType<typeof useRecentFiles>["addRecentFile"];
  addRecentFolder: ReturnType<typeof useRecentFiles>["addRecentFolder"];
  removeRecentFile: ReturnType<typeof useRecentFiles>["removeRecentFile"];
  windowState: ReturnType<typeof useWindowState>["windowState"];
  saveWindowState: ReturnType<typeof useWindowState>["saveState"];
  fileTree: FileEntry | null;
  refreshTree: () => Promise<void>;
  /** Load children for a single directory and merge into the tree. */
  loadChildren: (dirPath: string) => Promise<void>;
  gitStatus: GitStatusMap;
  refreshGitStatus: () => Promise<void>;
  projectConfig: ProjectConfig;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  sidebarTab: SidebarTab;
  setSidebarTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
  sidenotesCollapsed: boolean;
  setSidenotesCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  startupComplete: boolean;
  openProjectRoot: (path: string) => Promise<FileEntry | null>;
  handleOpenFolder: () => void;
  /** Generation counter — incremented before each project-root change. */
  workspaceRequestRef: { readonly current: number };
}

export function useAppWorkspaceSession(fs: FileSystem): AppWorkspaceSessionController {
  const { settings, updateSetting } = useSettings();
  const { theme, setTheme, resolvedTheme } = useTheme(
    settings.theme,
    (next) => { updateSetting("theme", next); },
    settings.themeName,
    settings.customCss,
    settings.writingTheme,
  );
  const { windowState, saveState: saveWindowState } = useWindowState();
  const [projectRoot, setProjectRoot] = useState<string | null>(windowState.projectRoot);
  const {
    recentFiles,
    recentFolders,
    addRecentFile,
    addRecentFolder,
    removeRecentFile,
  } = useRecentFiles(projectRoot);

  const [fileTree, setFileTree] = useState<FileEntry | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusMap>({});
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(true);
  const [startupComplete, setStartupComplete] = useState(false);
  const workspaceRequestRef = useRef(0);
  const gitStatusRequestRef = useRef(0);

  const clearRestoredProjectState = useCallback(() => {
    setProjectRoot(null);
    setFileTree(null);
    ++gitStatusRequestRef.current;
    setGitStatus({});
    setProjectConfig({});
    saveWindowState({
      projectRoot: null,
      currentDocument: null,
    });
  }, [saveWindowState]);

  /** Fetch git working-tree status (Tauri only; no-op in browser mode).
   *  Uses its own monotonic counter so overlapping refreshes within the
   *  same workspace are correctly ordered (only the newest wins). */
  const loadGitStatus = useCallback(async () => {
    if (!isTauri()) return;
    const id = ++gitStatusRequestRef.current;
    try {
      const { gitStatusCommand } = await import("../tauri-client/git");
      const status = await measureAsync("sidebar.git_status", () => gitStatusCommand(), {
        category: "sidebar",
      });
      if (id !== gitStatusRequestRef.current) return;
      setGitStatus(status);
    } catch (e: unknown) {
      if (id !== gitStatusRequestRef.current) return;
      console.error("[workspace] failed to load git status", e);
      setGitStatus({});
    }
  }, []);

  /** Fire-and-forget git status refresh. */
  const refreshGitStatus = useCallback(async () => {
    void loadGitStatus();
  }, [loadGitStatus]);

  const loadWorkspaceContents = useCallback(async (requestId: number): Promise<FileEntry | null> => {
    if (fs.listChildren) {
      // Shallow load: root children + config in parallel — sidebar renders
      // immediately.  Sub-directory children are loaded on demand when the
      // user expands them.  Consumers that need full depth (export) call
      // listTree() directly; default-doc search uses listChildren lazily.
      const [shallowChildren, nextProjectConfig] = await Promise.all([
        measureAsync("sidebar.file_tree_shallow", () => fs.listChildren!(""), {
          category: "sidebar",
        }),
        measureAsync(
          "startup.project_config",
          () => loadProjectConfig(fs),
          { category: "startup" },
        ),
      ]);
      if (requestId !== workspaceRequestRef.current) return null;
      const tree: FileEntry = { name: "project", path: "", isDirectory: true, children: shallowChildren };
      setFileTree(tree);
      setProjectConfig(nextProjectConfig);
      void loadGitStatus();
      return tree;
    }

    // Browser / demo mode: load the complete tree in one shot.
    const [tree, nextProjectConfig] = await Promise.all([
      measureAsync("sidebar.file_tree", () => fs.listTree(), {
        category: "sidebar",
      }),
      measureAsync(
        "startup.project_config",
        () => loadProjectConfig(fs),
        { category: "startup" },
      ),
    ]);
    if (requestId !== workspaceRequestRef.current) return null;
    setFileTree(tree);
    setProjectConfig(nextProjectConfig);
    void loadGitStatus();
    return tree;
  }, [fs, loadGitStatus]);

  const refreshTree = useCallback(async () => {
    const requestId = workspaceRequestRef.current;
    if (isTauri() && !projectRoot) {
      setFileTree(null);
      ++gitStatusRequestRef.current;
      setGitStatus({});
      return;
    }
    try {
      // Full recursive load so expanded folders keep their children and
      // consumers (export, default-doc) still see the complete tree.
      const tree = await measureAsync("sidebar.file_tree", () => fs.listTree(), {
        category: "sidebar",
      });
      if (requestId !== workspaceRequestRef.current) {
        return;
      }
      setFileTree(tree);
      void loadGitStatus();
    } catch (e: unknown) {
      if (requestId !== workspaceRequestRef.current) {
        return;
      }
      console.error("[workspace] failed to list file tree", e);
      setFileTree(null);
    }
  }, [fs, projectRoot, loadGitStatus]);

  const loadChildren = useCallback(async (dirPath: string) => {
    if (!fs.listChildren) return;
    const requestId = workspaceRequestRef.current;
    try {
      const children = await fs.listChildren(dirPath);
      // Drop stale responses from a previous project.
      if (requestId !== workspaceRequestRef.current) return;
      setFileTree((prev) => prev ? mergeChildrenIntoTree(prev, dirPath, children) : prev);
    } catch (e: unknown) {
      console.error("[workspace] failed to load children for", dirPath, e);
    }
  }, [fs]);

  const openProjectRoot = useCallback(async (path: string): Promise<FileEntry | null> => {
    if (!isTauri()) return null;
    const requestId = ++workspaceRequestRef.current;
    const { openFolderAt } = await tauriFs();
    const opened = await openFolderAt(path, requestId);
    if (!opened || requestId !== workspaceRequestRef.current) {
      return null;
    }
    setProjectRoot(path);
    ++gitStatusRequestRef.current;
    setGitStatus({});
    saveWindowState({
      projectRoot: path,
      currentDocument: null,
    });
    const tree = await loadWorkspaceContents(requestId);
    return tree;
  }, [loadWorkspaceContents, saveWindowState]);

  useEffect(() => {
    void withPerfOperation("startup.initial_session", async () => {
      try {
        if (isTauri()) {
          if (windowState.projectRoot) {
            const requestId = ++workspaceRequestRef.current;
            try {
              const { openFolderAt } = await tauriFs();
              const opened = await openFolderAt(windowState.projectRoot, requestId);
              if (!opened || requestId !== workspaceRequestRef.current) {
                return;
              }
              setProjectRoot(windowState.projectRoot);
              await loadWorkspaceContents(requestId);
            } catch (e: unknown) {
              if (requestId !== workspaceRequestRef.current) {
                return;
              }
              console.error("[workspace] failed to restore saved project root", e);
              clearRestoredProjectState();
            }
          } else {
            setFileTree(null);
            setProjectConfig({});
          }
        } else {
          const requestId = ++workspaceRequestRef.current;
          await loadWorkspaceContents(requestId);
        }
      } finally {
        setStartupComplete(true);
      }
    }).catch((e: unknown) => {
      console.error("[workspace] initial session startup failed", e);
      setStartupComplete(true);
    });
  }, [clearRestoredProjectState, loadWorkspaceContents, windowState.projectRoot]);

  const handleOpenFolder = useCallback(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { pickFolder } = await tauriFs();
        const folderPath = await pickFolder();
        if (folderPath) {
          const tree = await openProjectRoot(folderPath);
          if (!tree) {
            return;
          }
          addRecentFolder(folderPath);
        }
      } catch (e: unknown) {
        console.error("[workspace] handleOpenFolder failed", e);
      }
    })();
  }, [addRecentFolder, openProjectRoot]);

  return {
    settings,
    updateSetting,
    theme,
    setTheme,
    resolvedTheme,
    projectRoot,
    recentFiles,
    recentFolders,
    addRecentFile,
    addRecentFolder,
    removeRecentFile,
    windowState,
    saveWindowState,
    fileTree,
    refreshTree,
    loadChildren,
    gitStatus,
    refreshGitStatus,
    projectConfig,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    sidebarTab,
    setSidebarTab,
    sidenotesCollapsed,
    setSidenotesCollapsed,
    startupComplete,
    openProjectRoot,
    handleOpenFolder,
    workspaceRequestRef,
  };
}
