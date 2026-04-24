import { useCallback, useEffect, useRef, useState } from "react";
import {
  getFileParentPath,
  mergeLazyFileTreeChildren,
  replaceFileTreeChildren,
} from "../../lib/file-tree-model";
import { isTauri } from "../../lib/tauri";
import type { FileEntry, FileSystem } from "../file-manager";
import { measureAsync, withPerfOperation } from "../perf";
import type { ProjectConfig } from "../project-config";
import { loadProjectConfig, PROJECT_CONFIG_FILE } from "../project-config";
import type { ProjectOpenResult } from "../project-open-result";
import { useRecentFiles } from "./use-recent-files";
import { useSettings } from "./use-settings";
import { useTheme } from "./use-theme";
import { useWindowState } from "./use-window-state";

// Lazy-loaded to keep tauri-fs out of the browser startup chunk (#446).
// Other modules already dynamically import tauri-fs; this static import
// was the only thing preventing Vite from code-splitting it.
const tauriFs = () => import("../tauri-fs");

export {
  mergeLazyFileTreeChildren as mergeChildrenIntoTree,
  replaceFileTreeChildren as replaceChildrenInTree,
} from "../../lib/file-tree-model";

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
  refreshTree: (changedPath?: string) => Promise<void>;
  /** Load children for a single directory and merge into the tree. */
  loadChildren: (dirPath: string) => Promise<void>;
  projectConfig: ProjectConfig;
  startupComplete: boolean;
  openProjectRoot: (path: string) => Promise<ProjectOpenResult | null>;
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
  const projectRoot = windowState.projectRoot;
  const {
    recentFiles,
    recentFolders,
    addRecentFile,
    addRecentFolder,
    removeRecentFile,
  } = useRecentFiles(projectRoot);

  const [fileTree, setFileTree] = useState<FileEntry | null>(null);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});
  const [startupComplete, setStartupComplete] = useState(false);
  const workspaceRequestRef = useRef(0);
  const fullTreeRefreshGenerationRef = useRef(0);
  const scopedRefreshGenerationRef = useRef(new Map<string, number>());
  const startupRestoreRootRef = useRef(windowState.projectRoot);
  const startupStartedRef = useRef(false);

  const clearRestoredProjectState = useCallback(() => {
    setFileTree(null);
    setProjectConfig({});
    saveWindowState({
      projectRoot: null,
      currentDocument: null,
    });
  }, [saveWindowState]);

  const loadWorkspaceContents = useCallback(async (requestId: number): Promise<FileEntry | null> => {
    if (fs.listChildren) {
      // Shallow load: root children + config in parallel — sidebar renders
      // immediately.  Sub-directory children are loaded on demand when the
      // user expands them.  Consumers that need full depth (export) call
      // listTree() directly; default-doc search uses listChildren lazily.
      const [shallowChildren, nextProjectConfig] = await Promise.all([
        measureAsync("sidebar.file_tree_shallow", () => fs.listChildren?.("") as Promise<FileEntry[]>, {
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
    return tree;
  }, [fs]);

  const refreshTree = useCallback(async (changedPath?: string) => {
    const requestId = workspaceRequestRef.current;
    if (isTauri() && !projectRoot) {
      setFileTree(null);
      return;
    }

    // Scoped refresh: reload only the parent directory of the changed path.
    if (changedPath !== undefined && fs.listChildren) {
      const dir = getFileParentPath(changedPath);
      const shouldReloadProjectConfig = changedPath === PROJECT_CONFIG_FILE;
      const fullTreeGenerationAtStart = fullTreeRefreshGenerationRef.current;
      const scopedGeneration = (scopedRefreshGenerationRef.current.get(dir) ?? 0) + 1;
      scopedRefreshGenerationRef.current.set(dir, scopedGeneration);
      const scopedRefreshIsCurrent = () =>
        requestId === workspaceRequestRef.current
        && fullTreeGenerationAtStart === fullTreeRefreshGenerationRef.current
        && scopedRefreshGenerationRef.current.get(dir) === scopedGeneration;
      try {
        const [children, nextProjectConfig] = await Promise.all([
          measureAsync(
            "sidebar.file_tree_dir",
            () => fs.listChildren?.(dir) as Promise<FileEntry[]>,
            { category: "sidebar", detail: dir },
          ),
          shouldReloadProjectConfig
            ? measureAsync(
              "project_config.reload",
              () => loadProjectConfig(fs),
              { category: "workspace", detail: PROJECT_CONFIG_FILE },
            )
            : Promise.resolve<ProjectConfig | null>(null),
        ]);
        if (!scopedRefreshIsCurrent()) return;
        setFileTree((prev) => prev ? replaceFileTreeChildren(prev, dir, children) : prev);
        if (nextProjectConfig !== null) {
          setProjectConfig(nextProjectConfig);
        }
        return;
      } catch (e: unknown) {
        if (!scopedRefreshIsCurrent()) return;
        console.error("[workspace] scoped tree refresh failed, falling back to full refresh", e);
      }
    }

    // Full recursive load so expanded folders keep their children and
    // consumers (export, default-doc) still see the complete tree.
    const fullTreeGeneration = fullTreeRefreshGenerationRef.current + 1;
    fullTreeRefreshGenerationRef.current = fullTreeGeneration;
    try {
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
      if (requestId !== workspaceRequestRef.current) {
        return;
      }
      if (fullTreeRefreshGenerationRef.current !== fullTreeGeneration) {
        return;
      }
      setFileTree(tree);
      setProjectConfig(nextProjectConfig);
    } catch (e: unknown) {
      if (requestId !== workspaceRequestRef.current) {
        return;
      }
      if (fullTreeRefreshGenerationRef.current !== fullTreeGeneration) {
        return;
      }
      console.error("[workspace] failed to list file tree", e);
      setFileTree(null);
    }
  }, [fs, projectRoot]);

  const loadChildren = useCallback(async (dirPath: string) => {
    if (!fs.listChildren) return;
    const requestId = workspaceRequestRef.current;
    try {
      const children = await fs.listChildren(dirPath);
      // Drop stale responses from a previous project.
      if (requestId !== workspaceRequestRef.current) return;
      setFileTree((prev) => prev ? mergeLazyFileTreeChildren(prev, dirPath, children) : prev);
    } catch (e: unknown) {
      console.error("[workspace] failed to load children for", dirPath, e);
    }
  }, [fs]);

  /** Open a Tauri project folder with stale-request protection, set the root,
   *  and hydrate workspace contents.
   *
   *  Shared by startup restore and user-initiated project open.  `onRootSet`
   *  runs after the folder is validated and the root is set but before workspace
   *  contents are loaded — use it to clear state that must not leak across
   *  projects (window state, etc.).
   *
   *  Returns the file tree on success or null when the folder couldn't be opened
   *  or a newer request superseded this one.  Stale errors are silently
   *  swallowed; current errors re-throw. */
  const openTauriFolder = useCallback(async (
    path: string,
    onRootSet?: (projectRoot: string) => void,
  ): Promise<ProjectOpenResult | null> => {
    const requestId = ++workspaceRequestRef.current;
    try {
      const { openFolderAt } = await tauriFs();
      const result = await openFolderAt(path, requestId);
      if (!result.applied || requestId !== workspaceRequestRef.current) {
        return null;
      }
      const canonicalRoot = result.root;
      onRootSet?.(canonicalRoot);
      const tree = await loadWorkspaceContents(requestId);
      return tree ? { projectRoot: canonicalRoot, tree } : null;
    } catch (e: unknown) {
      if (requestId !== workspaceRequestRef.current) return null;
      throw e;
    }
  }, [loadWorkspaceContents]);

  const openProjectRoot = useCallback(async (path: string): Promise<ProjectOpenResult | null> => {
    if (!isTauri()) return null;
    const result = await openTauriFolder(path, (projectRoot) => {
      saveWindowState({ projectRoot, currentDocument: null });
    });
    if (result) {
      setStartupComplete(true);
    }
    return result;
  }, [openTauriFolder, saveWindowState]);

  useEffect(() => {
    if (startupStartedRef.current) {
      return;
    }
    startupStartedRef.current = true;
    const restoredProjectRoot = startupRestoreRootRef.current;
    let startupRequestId = workspaceRequestRef.current;
    void withPerfOperation("startup.initial_session", async () => {
      try {
        if (isTauri()) {
          if (restoredProjectRoot) {
            startupRequestId = workspaceRequestRef.current + 1;
            try {
              await openTauriFolder(restoredProjectRoot, (projectRoot) => {
                if (projectRoot !== restoredProjectRoot) {
                  saveWindowState({ projectRoot });
                }
              });
            } catch (e: unknown) {
              console.error("[workspace] failed to restore saved project root", e);
              clearRestoredProjectState();
            }
          } else {
            setFileTree(null);
            setProjectConfig({});
          }
        } else {
          const requestId = ++workspaceRequestRef.current;
          startupRequestId = requestId;
          await loadWorkspaceContents(requestId);
        }
      } finally {
        if (workspaceRequestRef.current === startupRequestId) {
          setStartupComplete(true);
        }
      }
    }).catch((e: unknown) => {
      console.error("[workspace] initial session startup failed", e);
      if (workspaceRequestRef.current === startupRequestId) {
        setStartupComplete(true);
      }
    });
  }, [
    clearRestoredProjectState,
    openTauriFolder,
    loadWorkspaceContents,
    saveWindowState,
  ]);

  const handleOpenFolder = useCallback(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { pickFolder } = await tauriFs();
        const folderPath = await pickFolder();
        if (folderPath) {
          const result = await openProjectRoot(folderPath);
          if (!result) {
            return;
          }
          addRecentFolder(result.projectRoot);
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
    projectConfig,
    startupComplete,
    openProjectRoot,
    handleOpenFolder,
    workspaceRequestRef,
  };
}
