import { useState, useEffect, useMemo, useCallback } from "react";
import { BackgroundIndexer } from "../../index";
import { dispatchFormatEvent } from "../../constants/events";
import { batchExport, exportDocument } from "../export";
import type { FileSystem } from "../file-manager";
import { basename, modKey } from "../lib/utils";
import type { PaletteCommand } from "../components/command-palette";
import { useAutoSave } from "./use-auto-save";
import type { UseDialogsReturn } from "./use-dialogs";
import { useHotkeys } from "./use-hotkeys";
import { useMenuEvents } from "./use-menu-events";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";

interface AppOverlayDeps {
  fs: FileSystem;
  dialogs: UseDialogsReturn;
  suspendAutoSave: boolean;
  suspendAutoSaveRef: { current: boolean };
  suspendAutoSaveVersionRef: { current: number };
  workspace: Pick<
    AppWorkspaceSessionController,
    "settings" | "theme" | "setTheme" | "resolvedTheme" | "recentFiles" | "fileTree" | "setSidebarCollapsed" | "setSidebarTab" | "setSidenotesCollapsed" | "handleOpenFolder"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentPath" | "liveDocs" | "openFile" | "saveFile" | "saveAs" | "closeCurrentFile" | "hasDirtyDocument" | "pluginManager" | "handleInsertImage"
  >;
  onOpenFile: () => void;
  onQuit: () => void;
}

export interface AppOverlayController {
  commands: PaletteCommand[];
  indexer: BackgroundIndexer;
  openPalette: () => void;
}

export function useAppOverlays({
  fs,
  dialogs,
  suspendAutoSave,
  suspendAutoSaveRef,
  suspendAutoSaveVersionRef,
  workspace,
  editor,
  onOpenFile,
  onQuit,
}: AppOverlayDeps): AppOverlayController {
  const [indexer] = useState(() => new BackgroundIndexer());

  useEffect(() => {
    return () => {
      indexer.dispose();
    };
  }, [indexer]);

  const handleExportHtml = useCallback(() => {
    const currentPath = editor.currentPath;
    if (!currentPath) return;
    const doc = editor.liveDocs.current.get(currentPath) ?? "";
    void (async () => {
      try {
        const outputPath = await exportDocument(doc, "html", currentPath, fs);
        window.alert(`Exported to ${outputPath}`);
      } catch (err: unknown) {
        window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [editor.currentPath, editor.liveDocs, fs]);

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

  const handleSaveAs = useCallback(() => {
    void editor.saveAs().catch((e: unknown) => {
      console.error("[overlays] save-as failed", e);
    });
  }, [editor]);

  const commands: PaletteCommand[] = useMemo(() => [
    { id: "file.save", label: "Save File", category: "File", shortcut: `${modKey}+S`, action: () => { void editor.saveFile(); } },
    { id: "file.open-file", label: "Open File...", category: "File", shortcut: `${modKey}+O`, action: () => onOpenFile() },
    { id: "file.save-as", label: "Save As...", category: "File", shortcut: `${modKey}+Shift+S`, action: handleSaveAs },
    { id: "file.close-file", label: "Close File", category: "File", shortcut: `${modKey}+W`, action: () => { void editor.closeCurrentFile(); } },
    { id: "file.open-folder", label: "Open Folder...", category: "File", action: () => workspace.handleOpenFolder() },
    { id: "file.quit", label: "Quit App", category: "File", shortcut: `${modKey}+Q`, action: onQuit },
    ...(workspace.recentFiles ?? []).map((path, i) => ({
      id: `file.recent-${i}`,
      label: `Open Recent: ${basename(path)}`,
      category: "File",
      action: () => { void editor.openFile(path); },
    })),
    { id: "format.bold", label: "Toggle Bold", category: "Format", shortcut: `${modKey}+B`, action: () => dispatchFormatEvent("bold") },
    { id: "format.italic", label: "Toggle Italic", category: "Format", shortcut: `${modKey}+I`, action: () => dispatchFormatEvent("italic") },
    { id: "format.heading1", label: "Heading 1", category: "Format", action: () => dispatchFormatEvent("heading", { level: 1 }) },
    { id: "format.heading2", label: "Heading 2", category: "Format", action: () => dispatchFormatEvent("heading", { level: 2 }) },
    { id: "format.heading3", label: "Heading 3", category: "Format", action: () => dispatchFormatEvent("heading", { level: 3 }) },
    { id: "nav.go-to-line", label: "Go to Line", category: "Navigation", shortcut: `${modKey}+G`, action: () => dialogs.setGotoLineOpen(true) },
    { id: "nav.show-files", label: "Show Files Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("files"); } },
    { id: "nav.show-outline", label: "Show Outline Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("outline"); } },
    { id: "nav.search", label: "Find in Files", category: "Navigation", shortcut: `${modKey}+Shift+F`, action: () => dialogs.setSearchOpen(true) },
    { id: "nav.settings", label: "Settings", category: "Navigation", shortcut: `${modKey}+,`, action: () => dialogs.setSettingsOpen(true) },
    { id: "view.toggle-sidebar", label: "Toggle Sidebar", category: "View", shortcut: `${modKey}+\\`, action: () => workspace.setSidebarCollapsed((value) => !value) },
    { id: "view.toggle-sidenotes", label: "Toggle Sidenote Margin", category: "View", action: () => workspace.setSidenotesCollapsed((value) => !value) },
    { id: "view.toggle-theme", label: "Toggle Light/Dark Theme", category: "View", action: () => workspace.setTheme(workspace.resolvedTheme === "dark" ? "light" : "dark") },
    { id: "insert.image", label: "Insert Image", category: "Insert", action: () => editor.handleInsertImage() },
    { id: "export.html", label: "Export Current File to HTML", category: "Export", action: handleExportHtml },
    { id: "export.batch-html", label: "Export All Files to HTML", category: "Export", action: handleBatchExportHtml },
    { id: "help.shortcuts", label: "Keyboard Shortcuts", category: "Help", shortcut: `${modKey}+/`, action: () => dialogs.setShortcutsOpen(true) },
    { id: "help.about", label: "About Coflat", category: "Help", action: () => dialogs.setAboutOpen(true) },
  ], [dialogs, editor, workspace, handleExportHtml, handleBatchExportHtml, handleSaveAs, onOpenFile, onQuit]);

  useAutoSave(
    editor.hasDirtyDocument,
    editor.saveFile,
    workspace.settings.autoSaveInterval,
    suspendAutoSave,
    suspendAutoSaveRef,
    suspendAutoSaveVersionRef,
  );

  const hotkeys = useMemo(() => [
    { key: "mod+s", handler: () => { void editor.saveFile(); } },
    { key: "mod+shift+s", handler: handleSaveAs },
    { key: "mod+shift+p", handler: () => dialogs.setPaletteOpen((value) => !value) },
    { key: "mod+shift+f", handler: () => dialogs.setSearchOpen((value) => !value) },
    { key: "mod+,", handler: () => dialogs.setSettingsOpen((value) => !value) },
    { key: "mod+/", handler: () => dialogs.setShortcutsOpen((value) => !value) },
    { key: "mod+g", handler: () => dialogs.setGotoLineOpen((value) => !value) },
    { key: "mod+\\", handler: () => workspace.setSidebarCollapsed((value) => !value) },
  ], [dialogs, editor, handleSaveAs, workspace]);

  useHotkeys(hotkeys);

  useMenuEvents({
    onSave: () => { void editor.saveFile(); },
    onOpenFile: onOpenFile,
    onSaveAs: handleSaveAs,
    onCloseFile: () => { void editor.closeCurrentFile(); },
    onQuit: onQuit,
    onToggleSidebar: () => workspace.setSidebarCollapsed((value) => !value),
    onShowSearch: () => dialogs.setSearchOpen(true),
    onShowShortcuts: () => dialogs.setShortcutsOpen(true),
    onAbout: () => dialogs.setAboutOpen(true),
    onOpenFolder: workspace.handleOpenFolder,
    onExport: handleExportHtml,
  });

  return {
    commands,
    indexer,
    openPalette: () => dialogs.setPaletteOpen(true),
  };
}
