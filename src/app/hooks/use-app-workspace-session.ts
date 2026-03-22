import { useState, useEffect, useCallback } from "react";
import type { FileEntry, FileSystem } from "../file-manager";
import { loadProjectConfig } from "../project-config";
import type { ProjectConfig } from "../project-config";
import { useRecentFiles } from "./use-recent-files";
import { useSettings } from "./use-settings";
import { useTheme } from "./use-theme";
import { useWindowState } from "./use-window-state";
import { measureAsync, withPerfOperation } from "../perf";
import { isTauri, openFolder as tauriOpenFolder } from "../tauri-fs";

export type SidebarTab = "files" | "outline" | "symbols";

export interface AppWorkspaceSessionController {
  settings: ReturnType<typeof useSettings>["settings"];
  updateSetting: ReturnType<typeof useSettings>["updateSetting"];
  theme: ReturnType<typeof useTheme>["theme"];
  setTheme: ReturnType<typeof useTheme>["setTheme"];
  resolvedTheme: ReturnType<typeof useTheme>["resolvedTheme"];
  recentFiles: ReturnType<typeof useRecentFiles>["recentFiles"];
  addRecentFile: ReturnType<typeof useRecentFiles>["addRecentFile"];
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
  handleOpenFolder: () => void;
}

export function useAppWorkspaceSession(fs: FileSystem): AppWorkspaceSessionController {
  const { settings, updateSetting } = useSettings();
  const { theme, setTheme, resolvedTheme } = useTheme(
    settings.themeName,
    settings.customCss,
    settings.writingTheme,
  );
  const { recentFiles, addRecentFile } = useRecentFiles();
  const { windowState, saveState: saveWindowState } = useWindowState();

  const [fileTree, setFileTree] = useState<FileEntry | null>(null);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [sidenotesCollapsed, setSidenotesCollapsed] = useState(true);
  const refreshProjectConfig = useCallback(async () => {
    const nextProjectConfig = await measureAsync(
      "startup.project_config",
      () => loadProjectConfig(fs),
      { category: "startup" },
    );
    setProjectConfig(nextProjectConfig);
  }, [fs]);

  const refreshTree = useCallback(async () => {
    try {
      const tree = await measureAsync("sidebar.file_tree", () => fs.listTree(), {
        category: "sidebar",
      });
      setFileTree(tree);
    } catch {
      setFileTree(null);
    }
  }, [fs]);

  useEffect(() => {
    void withPerfOperation("startup.initial_session", async () => {
      await Promise.all([refreshTree(), refreshProjectConfig()]);
    });
  }, [refreshProjectConfig, refreshTree]);

  const handleOpenFolder = useCallback(() => {
    if (!isTauri()) return;
    void tauriOpenFolder().then((folderPath) => {
      if (folderPath) {
        void refreshTree();
        void refreshProjectConfig();
      }
    });
  }, [refreshProjectConfig, refreshTree]);

  return {
    settings,
    updateSetting,
    theme,
    setTheme,
    resolvedTheme,
    recentFiles,
    addRecentFile,
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
    handleOpenFolder,
  };
}
