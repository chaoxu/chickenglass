import { useState, useEffect, useCallback } from "react";
import type { FileEntry, FileSystem } from "../file-manager";
import { loadProjectConfig } from "../project-config";
import type { ProjectConfig } from "../project-config";
import { useRecentFiles } from "./use-recent-files";
import { useSettings } from "./use-settings";
import { useTheme } from "./use-theme";
import { useWindowState } from "./use-window-state";
import { measureAsync, withPerfOperation } from "../perf";
import {
  isTauri,
  openFolder as tauriOpenFolder,
  openFolderAt,
} from "../tauri-fs";

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
  openProjectRoot: (path: string) => Promise<void>;
  handleOpenFolder: () => void;
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
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(true);
  const [startupComplete, setStartupComplete] = useState(false);

  const clearRestoredProjectState = useCallback(() => {
    setProjectRoot(null);
    setFileTree(null);
    setProjectConfig({});
    saveWindowState({
      projectRoot: null,
      currentDocument: null,
    });
  }, [saveWindowState]);

  const loadWorkspaceContents = useCallback(async () => {
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
    setFileTree(tree);
    setProjectConfig(nextProjectConfig);
  }, [fs]);

  const refreshTree = useCallback(async () => {
    if (isTauri() && !projectRoot) {
      setFileTree(null);
      return;
    }
    try {
      const tree = await measureAsync("sidebar.file_tree", () => fs.listTree(), {
        category: "sidebar",
      });
      setFileTree(tree);
    } catch (e: unknown) {
      console.error("[workspace] failed to list file tree", e);
      setFileTree(null);
    }
  }, [fs, projectRoot]);

  const openProjectRoot = useCallback(async (path: string) => {
    if (!isTauri()) return;
    await openFolderAt(path);
    setProjectRoot(path);
    saveWindowState({
      projectRoot: path,
      currentDocument: null,
    });
    await loadWorkspaceContents();
  }, [loadWorkspaceContents, saveWindowState]);

  useEffect(() => {
    void withPerfOperation("startup.initial_session", async () => {
      try {
        if (isTauri()) {
          if (windowState.projectRoot) {
            try {
              await openFolderAt(windowState.projectRoot);
              setProjectRoot(windowState.projectRoot);
              await loadWorkspaceContents();
            } catch (e: unknown) {
              console.error("[workspace] failed to restore saved project root", e);
              clearRestoredProjectState();
            }
          } else {
            setFileTree(null);
            setProjectConfig({});
          }
        } else {
          await loadWorkspaceContents();
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
        const folderPath = await tauriOpenFolder();
        if (folderPath) {
          setProjectRoot(folderPath);
          addRecentFolder(folderPath);
          saveWindowState({
            projectRoot: folderPath,
            currentDocument: null,
          });
          await loadWorkspaceContents();
        }
      } catch (e: unknown) {
        console.error("[workspace] handleOpenFolder failed", e);
      }
    })();
  }, [addRecentFolder, loadWorkspaceContents, saveWindowState]);

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
  };
}
