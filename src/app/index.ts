// ── React shell ────────────────────────────────────────────────────────────────
export { AppShell } from "./app.tsx";

// ── Components ─────────────────────────────────────────────────────────────────
export { TabBar } from "./components/tab-bar";
export { Sidebar } from "./components/sidebar";
export { FileTree } from "./components/file-tree";
export { Outline } from "./components/outline";
export { StatusBar } from "./components/status-bar";
export { EditorPane } from "./components/editor-pane";
export { CommandPalette, type PaletteCommand } from "./components/command-palette";
export { SearchPanel } from "./components/search-panel";
export { AboutDialog } from "./components/about-dialog";
export { ShortcutsDialog } from "./components/shortcuts-dialog";
export { SettingsDialog } from "./components/settings-dialog";
export { SplitPane } from "./components/split-pane";
export { GotoLineDialog } from "./components/goto-line-dialog";

// ── Hooks ──────────────────────────────────────────────────────────────────────
export { useTheme, type Theme, type ResolvedTheme } from "./hooks/use-theme";
export { useAutoSave } from "./hooks/use-auto-save";
export { useWindowState } from "./hooks/use-window-state";
export { useRecentFiles } from "./hooks/use-recent-files";
export { useEditor } from "./hooks/use-editor";
export { useSettings } from "./hooks/use-settings";
export { useHotkeys } from "./hooks/use-hotkeys";

// ── Core utilities (still needed by consumers) ─────────────────────────────────
export {
  exportDocument,
  batchExport,
  collectMdPaths,
  type ExportFormat,
  type BatchExportProgress,
} from "./export";
export { isTauri } from "../lib/tauri";
export { openFolder, revealInFinder, TauriFileSystem } from "./tauri-fs";
export {
  type FileEntry,
  type FileSystem,
  MemoryFileSystem,
  createDemoFileSystem,
} from "./file-manager";
export { FileWatcher, type FileWatcherConfig } from "./file-watcher";
export {
  type ProjectConfig,
  type ProjectConfigStatus,
  projectConfigFacet,
  projectConfigStatusFacet,
  parseProjectConfig,
  parseProjectConfigWithStatus,
  mergeConfigs,
  loadProjectConfig,
  loadProjectConfigWithStatus,
  PROJECT_CONFIG_FILE,
} from "./project-config";

// ── Shared types ───────────────────────────────────────────────────────────────
export type { Tab } from "./tab-bar";
