import { useSettings } from "./use-settings";
import { useTheme } from "./use-theme";
import { useRecentFiles } from "./use-recent-files";
import type { UseWindowStateReturn } from "./use-window-state";

export interface AppPreferencesDeps {
  readonly projectRoot: string | null;
  readonly windowState: UseWindowStateReturn["windowState"];
  readonly saveWindowState: UseWindowStateReturn["saveState"];
}

export interface AppPreferencesController {
  readonly settings: ReturnType<typeof useSettings>["settings"];
  readonly updateSetting: ReturnType<typeof useSettings>["updateSetting"];
  readonly theme: ReturnType<typeof useTheme>["theme"];
  readonly setTheme: ReturnType<typeof useTheme>["setTheme"];
  readonly resolvedTheme: ReturnType<typeof useTheme>["resolvedTheme"];
  readonly recentFiles: ReturnType<typeof useRecentFiles>["recentFiles"];
  readonly recentFolders: ReturnType<typeof useRecentFiles>["recentFolders"];
  readonly addRecentFile: ReturnType<typeof useRecentFiles>["addRecentFile"];
  readonly addRecentFolder: ReturnType<typeof useRecentFiles>["addRecentFolder"];
  readonly removeRecentFile: ReturnType<typeof useRecentFiles>["removeRecentFile"];
  readonly windowState: UseWindowStateReturn["windowState"];
  readonly saveWindowState: UseWindowStateReturn["saveState"];
}

export function useAppPreferences({
  projectRoot,
  windowState,
  saveWindowState,
}: AppPreferencesDeps): AppPreferencesController {
  const { settings, updateSetting } = useSettings();
  const { theme, setTheme, resolvedTheme } = useTheme(
    settings.theme,
    (next) => { updateSetting("theme", next); },
    settings.themeName,
    settings.customCss,
    settings.writingTheme,
  );
  const {
    recentFiles,
    recentFolders,
    addRecentFile,
    addRecentFolder,
    removeRecentFile,
  } = useRecentFiles(projectRoot);

  return {
    settings,
    updateSetting,
    theme,
    setTheme,
    resolvedTheme,
    recentFiles,
    recentFolders,
    addRecentFile,
    addRecentFolder,
    removeRecentFile,
    windowState,
    saveWindowState,
  };
}
