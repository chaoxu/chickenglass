import { useCallback, useMemo, useRef } from "react";
import {
  dispatchFormatEvent,
  type FormatEventDetail,
  type HeadingFormatLevel,
  type SimpleFormatEventType,
} from "../../constants/events";
import { useDevSettings } from "../../state/dev-settings";
import type { PaletteCommand } from "../components/command-palette";
import type { FileSystem } from "../file-manager";
import { basename, modKey } from "../lib/utils";
import { type HotkeyBinding, useHotkeys } from "./use-hotkeys";
import { useMenuEvents } from "./use-menu-events";
import type { AppEditorShellController } from "./use-app-editor-shell";
import type { AppWorkspaceSessionController } from "./use-app-workspace-session";
import type { UseDialogsReturn } from "./use-dialogs";
import type { SidebarLayoutController } from "./use-sidebar-layout";
import { saveAsErrorMessage } from "../project-root-errors";

interface AppCommandRegistryDeps {
  readonly fs: FileSystem;
  readonly dialogs: UseDialogsReturn;
  readonly workspace: Pick<
    AppWorkspaceSessionController,
    "fileTree" | "recentFiles" | "resolvedTheme" | "setTheme"
  >;
  readonly sidebarLayout: Pick<
    SidebarLayoutController,
    "setSidebarCollapsed" | "setSidebarTab" | "setSidenotesCollapsed"
  >;
  readonly editor: Pick<
    AppEditorShellController,
    | "closeCurrentFile"
    | "currentPath"
    | "getCurrentDocText"
    | "getLexicalEditorHandle"
    | "handleInsertImage"
    | "openFile"
    | "saveAs"
    | "saveFile"
  >;
  readonly onOpenFile: () => void;
  readonly onOpenFolder: () => void;
  readonly onQuit: () => void;
  readonly onShowLabelBacklinks: () => void;
  readonly onRenameDocumentLabel: () => void;
}

/**
 * A single command definition that serves as the source of truth for the
 * command palette, keyboard shortcuts, and native menu event wiring.
 */
interface CommandDef {
  /** Unique command identifier (e.g., "file.save"). */
  id: string;
  /** Display label shown in the command palette. */
  label: string;
  /** Category for palette grouping. */
  category?: string;
  /** Display-only shortcut hint (e.g., "Cmd+S"). */
  shortcut?: string;
  /** Hotkey binding string (e.g., "mod+s"). Registers a global keyboard shortcut. */
  hotkey?: string;
  /** Tauri menu event ID (e.g., "file_save"). Wires the native menu bar. */
  menuId?: string;
  /** Action executed from the command palette or native menu. */
  action: () => void;
  /**
   * Optional hotkey handler override. Some commands need different behavior
   * when triggered via hotkey (e.g., toggling a dialog) vs palette (opening).
   * Defaults to `action` when not provided.
   */
  hotkeyAction?: () => void;
}

/** Extract PaletteCommand[] from the registry. */
function toPaletteCommands(defs: CommandDef[]): PaletteCommand[] {
  return defs.map(({ id, label, category, shortcut, action }) => ({
    id, label, category, shortcut, action,
  }));
}

/** Extract HotkeyBinding[] from entries that declare a hotkey. */
function toHotkeyBindings(defs: CommandDef[]): HotkeyBinding[] {
  const result: HotkeyBinding[] = [];
  for (const d of defs) {
    if (d.hotkey) {
      result.push({ key: d.hotkey, handler: d.hotkeyAction ?? d.action });
    }
  }
  return result;
}

/** Extract a menuId -> handler map from entries that declare a menuId. */
function toMenuHandlers(defs: CommandDef[]): Record<string, () => void> {
  const map: Record<string, () => void> = {};
  for (const d of defs) {
    if (d.menuId) map[d.menuId] = d.action;
  }
  return map;
}

function dispatchFormatDetail(detail: FormatEventDetail): void {
  if (detail.type === "heading") {
    dispatchFormatEvent("heading", { level: detail.level });
    return;
  }
  dispatchFormatEvent(detail.type);
}

export function useAppCommandRegistry({
  fs,
  dialogs,
  workspace,
  sidebarLayout,
  editor,
  onOpenFile,
  onOpenFolder,
  onQuit,
  onShowLabelBacklinks,
  onRenameDocumentLabel,
}: AppCommandRegistryDeps): PaletteCommand[] {
  const {
    closeCurrentFile,
    currentPath,
    getCurrentDocText,
    getLexicalEditorHandle,
    handleInsertImage,
    openFile,
    saveAs,
    saveFile,
  } = editor;
  const {
    fileTree,
    recentFiles,
    resolvedTheme,
    setTheme,
  } = workspace;
  const {
    setSidebarCollapsed,
    setSidebarTab,
    setSidenotesCollapsed,
  } = sidebarLayout;
  const latestEditorSnapshotRef = useRef({
    currentPath,
    getCurrentDocText,
    getLexicalEditorHandle,
  });
  latestEditorSnapshotRef.current = {
    currentPath,
    getCurrentDocText,
    getLexicalEditorHandle,
  };

  const handleExportHtml = useCallback(() => {
    if (!currentPath) return;
    const doc = getCurrentDocText();
    void (async () => {
      try {
        const { exportDocument } = await import("../export");
        const outputPath = await exportDocument(doc, "html", currentPath, fs);
        window.alert(`Exported to ${outputPath}`);
      } catch (err: unknown) {
        window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [currentPath, getCurrentDocText, fs]);

  const handleBatchExportHtml = useCallback(() => {
    if (!fileTree) return;
    void (async () => {
      const { batchExport } = await import("../export");
      // Fetch the full recursive tree at export time so that all nested
      // markdown files are included, even when the sidebar tree is shallow.
      const tree = await fs.listTree();
      const results = await batchExport(tree, "html", fs);
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
  }, [fileTree, fs]);

  const handleSaveAs = useCallback(() => {
    void saveAs().catch((e: unknown) => {
      window.alert(saveAsErrorMessage(e));
    });
  }, [saveAs]);

  const applyFormat = useCallback((detail: FormatEventDetail) => {
    const requestPath = currentPath;
    const editorHandle = getLexicalEditorHandle();
    if (!editorHandle) {
      dispatchFormatDetail(detail);
      return;
    }

    void import("../editor-format-actions").then(({ applyMarkdownFormatAction }) => {
      const latest = latestEditorSnapshotRef.current;
      if (
        latest.currentPath !== requestPath ||
        latest.getLexicalEditorHandle() !== editorHandle
      ) {
        return;
      }
      const handled = applyMarkdownFormatAction({
        editorHandle,
        getCurrentDocText: latest.getCurrentDocText,
      }, detail);
      if (!handled) {
        dispatchFormatDetail(detail);
      }
    });
  }, [currentPath, getLexicalEditorHandle]);

  const applySimpleFormat = useCallback((type: SimpleFormatEventType) => {
    applyFormat({ type });
  }, [applyFormat]);

  const applyHeading = useCallback((level: HeadingFormatLevel) => {
    applyFormat({ type: "heading", level });
  }, [applyFormat]);

  const commandDefs: CommandDef[] = useMemo(() => [
    // File
    { id: "file.save", label: "Save File", category: "File", shortcut: `${modKey}+S`, hotkey: "mod+s", menuId: "file_save", action: () => { void saveFile(); } },
    { id: "file.open-file", label: "Open File...", category: "File", shortcut: `${modKey}+O`, menuId: "file_open_file", action: () => onOpenFile() },
    { id: "file.save-as", label: "Save As...", category: "File", shortcut: `${modKey}+Shift+S`, hotkey: "mod+shift+s", menuId: "file_save_as", action: handleSaveAs },
    { id: "file.close-file", label: "Close File", category: "File", shortcut: `${modKey}+W`, menuId: "file_close_tab", action: () => { void closeCurrentFile(); } },
    { id: "file.open-folder", label: "Open Folder...", category: "File", menuId: "file_open_folder", action: onOpenFolder },
    { id: "file.quit", label: "Quit App", category: "File", shortcut: `${modKey}+Q`, menuId: "file_quit", action: onQuit },

    // Format
    { id: "format.bold", label: "Toggle Bold", category: "Format", shortcut: `${modKey}+B`, menuId: "format_bold", action: () => applySimpleFormat("bold") },
    { id: "format.italic", label: "Toggle Italic", category: "Format", shortcut: `${modKey}+I`, menuId: "format_italic", action: () => applySimpleFormat("italic") },
    { id: "format.code", label: "Toggle Code", category: "Format", menuId: "format_code", action: () => applySimpleFormat("code") },
    { id: "format.strikethrough", label: "Toggle Strikethrough", category: "Format", menuId: "format_strikethrough", action: () => applySimpleFormat("strikethrough") },
    { id: "format.highlight", label: "Toggle Highlight", category: "Format", menuId: "format_highlight", action: () => applySimpleFormat("highlight") },
    { id: "format.link", label: "Insert Link", category: "Format", menuId: "format_link", action: () => applySimpleFormat("link") },
    { id: "format.heading1", label: "Heading 1", category: "Format", action: () => applyHeading(1) },
    { id: "format.heading2", label: "Heading 2", category: "Format", action: () => applyHeading(2) },
    { id: "format.heading3", label: "Heading 3", category: "Format", action: () => applyHeading(3) },

    // Edit
    { id: "edit.rename-local-label", label: "Rename Local Label", category: "Edit", action: onRenameDocumentLabel },

    // Navigation
    { id: "nav.go-to-line", label: "Go to Line", category: "Navigation", shortcut: `${modKey}+G`, hotkey: "mod+g", action: () => dialogs.setGotoLineOpen(true), hotkeyAction: () => dialogs.setGotoLineOpen((value) => !value) },
    { id: "nav.show-files", label: "Show Files Panel", category: "Navigation", action: () => { setSidebarCollapsed(false); setSidebarTab("files"); } },
    { id: "nav.show-outline", label: "Show Outline Panel", category: "Navigation", action: () => { setSidebarCollapsed(false); setSidebarTab("outline"); } },
    { id: "nav.show-diagnostics", label: "Show Diagnostics Panel", category: "Navigation", action: () => { setSidebarCollapsed(false); setSidebarTab("diagnostics"); } },
    { id: "nav.search", label: "Find in Files", category: "Navigation", shortcut: `${modKey}+Shift+F`, hotkey: "mod+shift+f", menuId: "edit_find", action: () => dialogs.setSearchOpen(true), hotkeyAction: () => dialogs.setSearchOpen((value) => !value) },
    { id: "nav.show-label-references", label: "Show References to Label", category: "Navigation", action: onShowLabelBacklinks },
    { id: "nav.settings", label: "Settings", category: "Navigation", shortcut: `${modKey}+,`, hotkey: "mod+,", action: () => dialogs.setSettingsOpen(true), hotkeyAction: () => dialogs.setSettingsOpen((value) => !value) },

    // View
    { id: "view.toggle-sidebar", label: "Toggle Sidebar", category: "View", shortcut: `${modKey}+\\`, hotkey: "mod+\\", menuId: "view_toggle_sidebar", action: () => setSidebarCollapsed((value) => !value) },
    { id: "view.toggle-sidenotes", label: "Toggle Sidenote Margin", category: "View", action: () => setSidenotesCollapsed((value) => !value) },
    { id: "view.toggle-theme", label: "Toggle Light/Dark Theme", category: "View", action: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
    { id: "view.toggle-fps", label: "Toggle FPS Meter", category: "View", action: () => useDevSettings.getState().toggle("fpsCounter") },
    { id: "view.toggle-selection-always-on", label: "Toggle Selection Always On", category: "View", action: () => useDevSettings.getState().toggle("selectionAlwaysOn") },
    { id: "view.toggle-tree-view", label: "Toggle Tree View", category: "View", action: () => useDevSettings.getState().toggle("treeView") },
    { id: "view.toggle-perf-panel", label: "Toggle Perf Panel", category: "View", action: () => useDevSettings.getState().toggle("perfPanel") },
    { id: "view.toggle-command-log", label: "Toggle Command Log", category: "View", action: () => useDevSettings.getState().toggle("commandLogging") },
    { id: "view.toggle-focus-tracing", label: "Toggle Focus Tracing", category: "View", action: () => useDevSettings.getState().toggle("focusTracing") },

    // Insert
    { id: "insert.image", label: "Insert Image", category: "Insert", action: () => handleInsertImage() },

    // Export
    { id: "export.html", label: "Export Current File to HTML", category: "Export", menuId: "file_export", action: handleExportHtml },
    { id: "export.batch-html", label: "Export All Files to HTML", category: "Export", action: handleBatchExportHtml },

    // Help
    { id: "help.shortcuts", label: "Keyboard Shortcuts", category: "Help", shortcut: `${modKey}+/`, hotkey: "mod+/", menuId: "help_shortcuts", action: () => dialogs.setShortcutsOpen(true), hotkeyAction: () => dialogs.setShortcutsOpen((value) => !value) },
    { id: "help.about", label: "About Coflat", category: "Help", menuId: "help_about", action: () => dialogs.setAboutOpen(true) },

    // Recent files (palette only)
    ...(recentFiles ?? []).map((path, i) => ({
      id: `file.recent-${i}`,
      label: `Open Recent: ${basename(path)}`,
      category: "File",
      action: () => { void openFile(path); },
    })),
  ], [
    applyHeading,
    applySimpleFormat,
    dialogs,
    closeCurrentFile,
    handleExportHtml,
    handleBatchExportHtml,
    handleInsertImage,
    handleSaveAs,
    openFile,
    recentFiles,
    resolvedTheme,
    saveFile,
    setSidebarCollapsed,
    setSidebarTab,
    setSidenotesCollapsed,
    setTheme,
    onShowLabelBacklinks,
    onRenameDocumentLabel,
    onOpenFile,
    onOpenFolder,
    onQuit,
  ]);

  const commands = useMemo(() => toPaletteCommands(commandDefs), [commandDefs]);

  const hotkeys = useMemo(() => [
    { key: "mod+shift+p", handler: () => dialogs.setPaletteOpen((value) => !value) },
    ...toHotkeyBindings(commandDefs),
  ], [commandDefs, dialogs]);

  const menuHandlers = useMemo(() => toMenuHandlers(commandDefs), [commandDefs]);

  useHotkeys(hotkeys);
  useMenuEvents(menuHandlers);

  return commands;
}
