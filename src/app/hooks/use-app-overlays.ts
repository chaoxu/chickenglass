import { useCallback, useMemo } from "react";

import type { BackgroundIndexer } from "../../index";
import { dispatchFormatEvent } from "../../constants/events";
import type { DocumentLabelBacklinksResult } from "../markdown/labels";
import { useDevSettings } from "../../state/dev-settings";
import type { FileSystem } from "../file-manager";
import { basename, modKey } from "../lib/utils";
import type { PaletteCommand } from "../components/command-palette";
import { useAutoSave } from "./use-auto-save";
import type { UseDialogsReturn } from "./use-dialogs";
import { useHotkeys } from "./use-hotkeys";
import { useMenuEvents } from "./use-menu-events";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";
import type { SidebarLayoutController } from "./use-sidebar-layout";
import { TAURI_MENU_IDS } from "../tauri-client/bridge-metadata";
import {
  toHotkeyBindings,
  toMenuHandlers,
  toPaletteCommands,
  type CommandDef,
} from "./command-registry";
import { useAppLabelCommands } from "./use-app-label-commands";
import { useAppSearchIndex } from "./use-app-search-index";

interface AppOverlayDeps {
  fs: FileSystem;
  dialogs: UseDialogsReturn;
  suspendAutoSave: boolean;
  suspendAutoSaveRef: { current: boolean };
  suspendAutoSaveVersionRef: { current: number };
  workspace: Pick<
    AppWorkspaceSessionController,
    "settings" | "theme" | "setTheme" | "resolvedTheme" | "recentFiles" | "fileTree" | "handleOpenFolder"
  >;
  sidebarLayout: Pick<
    SidebarLayoutController,
    "setSidebarCollapsed" | "setSidebarTab" | "setSidenotesCollapsed"
  >;
  editor: Pick<
    AppEditorShellController,
    "currentPath" | "activeDocumentSignal" | "getCurrentDocText" | "peekCurrentDocText" | "editorHandle" | "openFile" | "saveFile" | "saveAs" | "closeCurrentFile" | "hasDirtyDocument" | "pluginManager" | "handleInsertImage"
  >;
  onOpenFile: () => void;
  onQuit: () => void;
}

export interface AppOverlayController {
  commands: PaletteCommand[];
  indexer: BackgroundIndexer;
  searchVersion: number;
  openPalette: () => void;
  labelBacklinks: DocumentLabelBacklinksResult | null;
  closeLabelBacklinks: () => void;
}

export function useAppOverlays({
  fs,
  dialogs,
  suspendAutoSave,
  suspendAutoSaveRef,
  suspendAutoSaveVersionRef,
  workspace,
  sidebarLayout,
  editor,
  onOpenFile,
  onQuit,
}: AppOverlayDeps): AppOverlayController {
  const { indexer, searchVersion } = useAppSearchIndex(fs, dialogs, editor, workspace.fileTree);
  const labelCommands = useAppLabelCommands(editor);

  const handleSaveAs = useCallback(() => {
    void editor.saveAs().catch((e: unknown) => {
      console.error("[overlays] save-as failed", e);
    });
  }, [editor]);

  const openSearch = useCallback(() => {
    editor.getCurrentDocText();
    dialogs.setSearchOpen(true);
  }, [dialogs, editor]);

  const toggleSearch = useCallback(() => {
    if (!dialogs.searchOpen) {
      editor.getCurrentDocText();
    }
    dialogs.setSearchOpen(!dialogs.searchOpen);
  }, [dialogs, editor]);

  // ── Single command registry ──────────────────────────────────────────────
  // Each command is defined once. Palette entries, hotkey bindings, and
  // Tauri menu handlers are all derived from this array.

  const commandDefs: CommandDef[] = useMemo(() => [
    // ── File ──────────────────────────────────────────────────────────────
    { id: "file.save", label: "Save File", category: "File", shortcut: `${modKey}+S`, hotkey: "mod+s", menuId: TAURI_MENU_IDS.fileSave, action: () => { void editor.saveFile(); } },
    { id: "file.open-file", label: "Open File...", category: "File", shortcut: `${modKey}+O`, menuId: TAURI_MENU_IDS.fileOpenFile, action: () => onOpenFile() },
    { id: "file.save-as", label: "Save As...", category: "File", shortcut: `${modKey}+Shift+S`, hotkey: "mod+shift+s", menuId: TAURI_MENU_IDS.fileSaveAs, action: handleSaveAs },
    { id: "file.close-file", label: "Close File", category: "File", shortcut: `${modKey}+W`, menuId: TAURI_MENU_IDS.fileCloseTab, action: () => { void editor.closeCurrentFile(); } },
    { id: "file.open-folder", label: "Open Folder...", category: "File", menuId: TAURI_MENU_IDS.fileOpenFolder, action: () => workspace.handleOpenFolder() },
    { id: "file.quit", label: "Quit App", category: "File", shortcut: `${modKey}+Q`, menuId: TAURI_MENU_IDS.fileQuit, action: onQuit },

    // ── Format ────────────────────────────────────────────────────────────
    { id: "format.bold", label: "Toggle Bold", category: "Format", shortcut: `${modKey}+B`, action: () => dispatchFormatEvent("bold") },
    { id: "format.italic", label: "Toggle Italic", category: "Format", shortcut: `${modKey}+I`, action: () => dispatchFormatEvent("italic") },
    { id: "format.heading1", label: "Heading 1", category: "Format", action: () => dispatchFormatEvent("heading", { level: 1 }) },
    { id: "format.heading2", label: "Heading 2", category: "Format", action: () => dispatchFormatEvent("heading", { level: 2 }) },
    { id: "format.heading3", label: "Heading 3", category: "Format", action: () => dispatchFormatEvent("heading", { level: 3 }) },

    // ── Edit ──────────────────────────────────────────────────────────────
    { id: "edit.rename-local-label", label: "Rename Local Label", category: "Edit", action: labelCommands.handleRenameDocumentLabel },

    // ── Navigation ────────────────────────────────────────────────────────
    { id: "nav.go-to-line", label: "Go to Line", category: "Navigation", shortcut: `${modKey}+G`, hotkey: "mod+g", action: () => dialogs.setGotoLineOpen(true), hotkeyAction: () => dialogs.setGotoLineOpen((value) => !value) },
    { id: "nav.show-files", label: "Show Files Panel", category: "Navigation", action: () => { sidebarLayout.setSidebarCollapsed(false); sidebarLayout.setSidebarTab("files"); } },
    { id: "nav.show-outline", label: "Show Outline Panel", category: "Navigation", action: () => { sidebarLayout.setSidebarCollapsed(false); sidebarLayout.setSidebarTab("outline"); } },
    { id: "nav.show-diagnostics", label: "Show Diagnostics Panel", category: "Navigation", action: () => { sidebarLayout.setSidebarCollapsed(false); sidebarLayout.setSidebarTab("diagnostics"); } },
    { id: "nav.search", label: "Find in Files", category: "Navigation", shortcut: `${modKey}+Shift+F`, hotkey: "mod+shift+f", menuId: TAURI_MENU_IDS.editFind, action: openSearch, hotkeyAction: toggleSearch },
    { id: "nav.show-label-references", label: "Show References to Label", category: "Navigation", action: labelCommands.handleShowLabelBacklinks },
    { id: "nav.settings", label: "Settings", category: "Navigation", shortcut: `${modKey}+,`, hotkey: "mod+,", action: () => dialogs.setSettingsOpen(true), hotkeyAction: () => dialogs.setSettingsOpen((value) => !value) },

    // ── View ──────────────────────────────────────────────────────────────
    { id: "view.toggle-sidebar", label: "Toggle Sidebar", category: "View", shortcut: `${modKey}+\\`, hotkey: "mod+\\", menuId: TAURI_MENU_IDS.viewToggleSidebar, action: () => sidebarLayout.setSidebarCollapsed((value) => !value) },
    { id: "view.toggle-sidenotes", label: "Toggle Sidenote Margin", category: "View", action: () => sidebarLayout.setSidenotesCollapsed((value) => !value) },
    { id: "view.toggle-theme", label: "Toggle Light/Dark Theme", category: "View", action: () => workspace.setTheme(workspace.resolvedTheme === "dark" ? "light" : "dark") },
    { id: "view.toggle-fps", label: "Toggle FPS Meter", category: "View", action: () => useDevSettings.getState().toggle("fpsCounter") },
    { id: "view.toggle-selection-always-on", label: "Toggle Selection Always On", category: "View", action: () => useDevSettings.getState().toggle("selectionAlwaysOn") },
    { id: "view.toggle-tree-view", label: "Toggle Tree View", category: "View", action: () => useDevSettings.getState().toggle("treeView") },

    // ── Help ──────────────────────────────────────────────────────────────
    { id: "help.shortcuts", label: "Keyboard Shortcuts", category: "Help", shortcut: `${modKey}+/`, hotkey: "mod+/", menuId: TAURI_MENU_IDS.helpShortcuts, action: () => dialogs.setShortcutsOpen(true), hotkeyAction: () => dialogs.setShortcutsOpen((value) => !value) },
    { id: "help.about", label: "About Coflat", category: "Help", menuId: TAURI_MENU_IDS.helpAbout, action: () => dialogs.setAboutOpen(true) },

    // ── Recent files (palette only) ──────────────────────────────────────
    ...(workspace.recentFiles ?? []).map((path, i) => ({
      id: `file.recent-${i}`,
      label: `Open Recent: ${basename(path)}`,
      category: "File",
      action: () => { void editor.openFile(path); },
    })),
  ], [dialogs, editor, workspace, sidebarLayout, handleSaveAs, labelCommands.handleShowLabelBacklinks, labelCommands.handleRenameDocumentLabel, onOpenFile, onQuit, openSearch, toggleSearch]);

  // ── Derive palette commands, hotkeys, and menu handlers ────────────────
  const commands = useMemo(() => toPaletteCommands(commandDefs), [commandDefs]);

  const hotkeys = useMemo(() => [
    // Palette toggle is a meta-command — not in the palette itself.
    { key: "mod+shift+p", handler: () => dialogs.setPaletteOpen((value) => !value) },
    ...toHotkeyBindings(commandDefs),
  ], [commandDefs, dialogs]);

  const menuHandlers = useMemo(() => toMenuHandlers(commandDefs), [commandDefs]);

  useAutoSave(
    editor.hasDirtyDocument,
    editor.saveFile,
    workspace.settings.autoSaveInterval,
    suspendAutoSave,
    suspendAutoSaveRef,
    suspendAutoSaveVersionRef,
  );

  useHotkeys(hotkeys);
  useMenuEvents(menuHandlers);

  return {
    commands,
    indexer,
    searchVersion,
    openPalette: () => dialogs.setPaletteOpen(true),
    labelBacklinks: labelCommands.labelBacklinks,
    closeLabelBacklinks: labelCommands.closeLabelBacklinks,
  };
}
