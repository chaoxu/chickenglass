import { useState, useEffect, useMemo, useCallback } from "react";
import { BackgroundIndexer } from "../../index";
import { dispatchFormatEvent } from "../../constants/events";
import { batchExport, exportDocument } from "../export";
import type { FileSystem } from "../file-manager";
import { basename, modKey } from "../lib/utils";
import type { PaletteCommand } from "../components/command-palette";
import { useAutoSave } from "./use-auto-save";
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
  commands: PaletteCommand[];
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

  // ── Palette commands ────────────────────────────────────────────────────────
  // Built directly from app deps — single source of truth for command palette.
  const commands: PaletteCommand[] = useMemo(() => [
    // ── File ──────────────────────────────────────────────────────────────────
    { id: "file.save", label: "Save File", category: "File", shortcut: `${modKey}+S`, action: () => { void editor.saveFile(); } },
    { id: "file.save-as", label: "Save As...", category: "File", shortcut: `${modKey}+Shift+S`, action: () => { void editor.saveAs(); } },
    { id: "file.close-tab", label: "Close Tab", category: "File", shortcut: `${modKey}+W`, action: () => { if (editor.activeTab) void editor.closeFile(editor.activeTab); } },
    { id: "file.open-folder", label: "Open Folder...", category: "File", action: () => workspace.handleOpenFolder() },

    // ── Recent files (dynamic) ────────────────────────────────────────────────
    ...(workspace.recentFiles ?? []).map((path, i) => ({
      id: `file.recent-${i}`,
      label: `Open Recent: ${basename(path)}`,
      category: "File",
      action: () => { void editor.openFile(path); },
    })),

    // ── Format ────────────────────────────────────────────────────────────────
    { id: "format.bold", label: "Toggle Bold", category: "Format", shortcut: `${modKey}+B`, action: () => dispatchFormatEvent("bold") },
    { id: "format.italic", label: "Toggle Italic", category: "Format", shortcut: `${modKey}+I`, action: () => dispatchFormatEvent("italic") },
    { id: "format.heading1", label: "Heading 1", category: "Format", action: () => dispatchFormatEvent("heading", { level: 1 }) },
    { id: "format.heading2", label: "Heading 2", category: "Format", action: () => dispatchFormatEvent("heading", { level: 2 }) },
    { id: "format.heading3", label: "Heading 3", category: "Format", action: () => dispatchFormatEvent("heading", { level: 3 }) },

    // ── Navigation ────────────────────────────────────────────────────────────
    { id: "nav.go-to-line", label: "Go to Line", category: "Navigation", shortcut: `${modKey}+G`, action: () => dialogs.setGotoLineOpen(true) },
    { id: "nav.show-files", label: "Show Files Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("files"); } },
    { id: "nav.show-outline", label: "Show Outline Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("outline"); } },
    { id: "nav.search", label: "Find in Files", category: "Navigation", shortcut: `${modKey}+Shift+F`, action: () => dialogs.setSearchOpen(true) },
    { id: "nav.settings", label: "Settings", category: "Navigation", shortcut: `${modKey}+,`, action: () => dialogs.setSettingsOpen(true) },

    // ── View ──────────────────────────────────────────────────────────────────
    { id: "view.toggle-sidebar", label: "Toggle Sidebar", category: "View", shortcut: `${modKey}+\\`, action: () => workspace.setSidebarCollapsed((value) => !value) },
    { id: "view.toggle-sidenotes", label: "Toggle Sidenote Margin", category: "View", action: () => workspace.setSidenotesCollapsed((value) => !value) },
    { id: "view.toggle-theme", label: "Toggle Light/Dark Theme", category: "View", action: () => workspace.setTheme(workspace.resolvedTheme === "dark" ? "light" : "dark") },

    // ── Insert ────────────────────────────────────────────────────────────────
    { id: "insert.image", label: "Insert Image", category: "Insert", action: () => editor.handleInsertImage() },

    // ── Export ────────────────────────────────────────────────────────────────
    { id: "export.html", label: "Export Current File to HTML", category: "Export", action: handleExportHtml },
    { id: "export.batch-html", label: "Export All Files to HTML", category: "Export", action: handleBatchExportHtml },

    // ── Help ──────────────────────────────────────────────────────────────────
    { id: "help.shortcuts", label: "Keyboard Shortcuts", category: "Help", shortcut: `${modKey}+/`, action: () => dialogs.setShortcutsOpen(true) },
    { id: "help.about", label: "About Coflat", category: "Help", action: () => dialogs.setAboutOpen(true) },
  ], [dialogs, editor, workspace, handleExportHtml, handleBatchExportHtml]);

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
