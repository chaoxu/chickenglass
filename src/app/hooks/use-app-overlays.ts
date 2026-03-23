import { useState, useEffect, useMemo, useCallback } from "react";
import { BackgroundIndexer } from "../../index";
import { batchExport, exportDocument } from "../export";
import type { FileSystem } from "../file-manager";
import { useAutoSave } from "./use-auto-save";
import { useCommands } from "./use-commands";
import { useDialogs, type UseDialogsReturn } from "./use-dialogs";
import { useHotkeys } from "./use-hotkeys";
import { useMenuEvents } from "./use-menu-events";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

interface AppOverlayDeps {
  fs: FileSystem;
  workspace: Pick<
    AppWorkspaceSessionController,
    "settings" | "theme" | "setTheme" | "resolvedTheme" | "recentFiles" | "fileTree" | "setSidebarCollapsed" | "setSidebarTab" | "setSidenotesCollapsed" | "handleOpenFolder"
  >;
  editor: Pick<
    AppEditorShellController,
    "activeTab" | "liveDocs" | "openFile" | "saveFile" | "saveAs" | "closeFile" | "hasDirtyFiles" | "pluginManager" | "handleInsertImage"
  >;
}

export interface AppOverlayController {
  dialogs: UseDialogsReturn;
  commands: ReturnType<typeof useCommands>;
  indexer: BackgroundIndexer;
  openPalette: () => void;
}

export function useAppOverlays({ fs, workspace, editor }: AppOverlayDeps): AppOverlayController {
  const dialogs = useDialogs();
  const [indexer] = useState(() => new BackgroundIndexer());

  useEffect(() => {
    return () => {
      indexer.dispose();
    };
  }, [indexer]);

  const handleExportHtml = useCallback(() => {
    const activeTab = editor.activeTab;
    if (!activeTab) return;
    const activeTabPath = activeTab;
    const doc = editor.liveDocs.current.get(activeTabPath) ?? "";
    void (async () => {
      try {
        const outputPath = await exportDocument(doc, "html", activeTabPath, fs);
        window.alert(`Exported to ${outputPath}`);
      } catch (err: unknown) {
        window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [editor.activeTab, editor.liveDocs, fs]);

  const handleBatchExportHtml = useCallback(() => {
    const fileTree = workspace.fileTree;
    if (!fileTree) return;
    void (async () => {
      const results = await batchExport(fileTree, "html", fs);
      const succeeded = results.filter((result) => result.outputPath);
      const failed = results.filter((result) => result.error);
      const summary = [`Batch export complete: ${succeeded.length} succeeded`];
      if (failed.length > 0) {
        summary.push(`${failed.length} failed`);
        for (const failure of failed) {
          summary.push(`  ${failure.path}: ${failure.error}`);
        }
      }
      window.alert(summary.join("\n"));
    })().catch((e: unknown) => {
      window.alert(`Batch export failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, [workspace.fileTree, fs]);

  const commandHandlers = useMemo(() => ({
    onSave: () => { void editor.saveFile(); },
    onSaveAs: () => { void editor.saveAs(); },
    onCloseTab: () => { if (editor.activeTab) void editor.closeFile(editor.activeTab); },
    onToggleSidebar: () => workspace.setSidebarCollapsed((value) => !value),
    onToggleSidenotes: () => workspace.setSidenotesCollapsed((value) => !value),
    onInsertImage: editor.handleInsertImage,
    onShowFiles: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("files"); },
    onShowOutline: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("outline"); },
    onToggleTheme: () => workspace.setTheme(workspace.resolvedTheme === "dark" ? "light" : "dark"),
    onGoToLine: () => dialogs.setGotoLineOpen(true),
    onAbout: () => dialogs.setAboutOpen(true),
    onShowShortcuts: () => dialogs.setShortcutsOpen(true),
    onShowSettings: () => dialogs.setSettingsOpen(true),
    onShowSearch: () => dialogs.setSearchOpen(true),
    onOpenFolder: workspace.handleOpenFolder,
    onOpenRecentFile: (path: string) => { void editor.openFile(path); },
    recentFiles: workspace.recentFiles,
    onExportHtml: handleExportHtml,
    onBatchExportHtml: handleBatchExportHtml,
  }), [dialogs, editor, workspace, handleExportHtml, handleBatchExportHtml]);

  const commands = useCommands(commandHandlers);

  useAutoSave(editor.hasDirtyFiles, editor.saveFile, workspace.settings.autoSaveInterval);

  useHotkeys([
    { key: "mod+s", handler: () => { void editor.saveFile(); } },
    { key: "mod+shift+s", handler: () => { void editor.saveAs(); } },
    { key: "mod+shift+p", handler: () => dialogs.setPaletteOpen((value) => !value) },
    { key: "mod+shift+f", handler: () => dialogs.setSearchOpen((value) => !value) },
    { key: "mod+,", handler: () => dialogs.setSettingsOpen((value) => !value) },
    { key: "mod+/", handler: () => dialogs.setShortcutsOpen((value) => !value) },
    { key: "mod+g", handler: () => dialogs.setGotoLineOpen((value) => !value) },
    { key: "mod+b", handler: () => workspace.setSidebarCollapsed((value) => !value) },
  ]);

  useMenuEvents({
    onSave: () => { void editor.saveFile(); },
    onSaveAs: () => { void editor.saveAs(); },
    onCloseTab: () => { if (editor.activeTab) void editor.closeFile(editor.activeTab); },
    onToggleSidebar: () => workspace.setSidebarCollapsed((value) => !value),
    onShowSearch: () => dialogs.setSearchOpen(true),
    onShowShortcuts: () => dialogs.setShortcutsOpen(true),
    onAbout: () => dialogs.setAboutOpen(true),
    onOpenFolder: workspace.handleOpenFolder,
  });

  return {
    dialogs,
    commands,
    indexer,
    openPalette: () => dialogs.setPaletteOpen(true),
  };
}
