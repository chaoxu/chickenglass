import { useState, useEffect, useMemo, useCallback } from "react";
import { BackgroundIndexer } from "../../index";
import { dispatchFormatEvent } from "../../constants/events";
import { toggleFpsMeter } from "../fps-meter";
import { batchExport, exportDocument } from "../export";
import type { FileSystem } from "../file-manager";
import { basename, modKey } from "../lib/utils";
import type { PaletteCommand } from "../components/command-palette";
import { collectSearchableMarkdownPaths } from "../search";
import { useAutoSave } from "./use-auto-save";
import type { UseDialogsReturn } from "./use-dialogs";
import { useHotkeys, type HotkeyBinding } from "./use-hotkeys";
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
    "currentPath" | "liveDocs" | "docTextForStats" | "openFile" | "saveFile" | "saveAs" | "closeCurrentFile" | "hasDirtyDocument" | "pluginManager" | "handleInsertImage"
  >;
  onOpenFile: () => void;
  onQuit: () => void;
}

export interface AppOverlayController {
  commands: PaletteCommand[];
  indexer: BackgroundIndexer;
  searchVersion: number;
  openPalette: () => void;
}

// ── Command registry ─────────────────────────────────────────────────────────

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

/** Extract a menuId → handler map from entries that declare a menuId. */
function toMenuHandlers(defs: CommandDef[]): Record<string, () => void> {
  const map: Record<string, () => void> = {};
  for (const d of defs) {
    if (d.menuId) map[d.menuId] = d.action;
  }
  return map;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

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
  const [searchVersion, setSearchVersion] = useState(0);
  const activeSearchDoc = editor.currentPath ? editor.docTextForStats : "";

  useEffect(() => {
    if (!dialogs.searchOpen) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const tree = await fs.listTree();
        const markdownPaths = collectSearchableMarkdownPaths(tree);
        const files = await Promise.all(
          markdownPaths.map(async (path) => ({
            file: path,
            content:
              path === editor.currentPath
                ? activeSearchDoc
                : await fs.readFile(path),
          })),
        );

        if (!cancelled) {
          await indexer.bulkUpdate(files);
          setSearchVersion((version) => version + 1);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[search] failed to build app search index", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    dialogs.searchOpen,
    workspace.fileTree,
    fs,
    indexer,
  ]);

  useEffect(() => {
    if (!dialogs.searchOpen || !editor.currentPath?.endsWith(".md")) {
      return;
    }

    void indexer
      .updateFile(editor.currentPath, activeSearchDoc)
      .then(() => {
        setSearchVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        console.error("[search] failed to sync active file into app search index", error);
      });
  }, [dialogs.searchOpen, indexer, editor.currentPath, activeSearchDoc]);

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
    if (!workspace.fileTree) return;
    void (async () => {
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
  }, [workspace.fileTree, fs]);

  const handleSaveAs = useCallback(() => {
    void editor.saveAs().catch((e: unknown) => {
      console.error("[overlays] save-as failed", e);
    });
  }, [editor]);

  // ── Single command registry ──────────────────────────────────────────────
  // Each command is defined once. Palette entries, hotkey bindings, and
  // Tauri menu handlers are all derived from this array.

  const commandDefs: CommandDef[] = useMemo(() => [
    // ── File ──────────────────────────────────────────────────────────────
    { id: "file.save", label: "Save File", category: "File", shortcut: `${modKey}+S`, hotkey: "mod+s", menuId: "file_save", action: () => { void editor.saveFile(); } },
    { id: "file.open-file", label: "Open File...", category: "File", shortcut: `${modKey}+O`, menuId: "file_open_file", action: () => onOpenFile() },
    { id: "file.save-as", label: "Save As...", category: "File", shortcut: `${modKey}+Shift+S`, hotkey: "mod+shift+s", menuId: "file_save_as", action: handleSaveAs },
    { id: "file.close-file", label: "Close File", category: "File", shortcut: `${modKey}+W`, menuId: "file_close_tab", action: () => { void editor.closeCurrentFile(); } },
    { id: "file.open-folder", label: "Open Folder...", category: "File", menuId: "file_open_folder", action: () => workspace.handleOpenFolder() },
    { id: "file.quit", label: "Quit App", category: "File", shortcut: `${modKey}+Q`, menuId: "file_quit", action: onQuit },

    // ── Format ────────────────────────────────────────────────────────────
    { id: "format.bold", label: "Toggle Bold", category: "Format", shortcut: `${modKey}+B`, action: () => dispatchFormatEvent("bold") },
    { id: "format.italic", label: "Toggle Italic", category: "Format", shortcut: `${modKey}+I`, action: () => dispatchFormatEvent("italic") },
    { id: "format.heading1", label: "Heading 1", category: "Format", action: () => dispatchFormatEvent("heading", { level: 1 }) },
    { id: "format.heading2", label: "Heading 2", category: "Format", action: () => dispatchFormatEvent("heading", { level: 2 }) },
    { id: "format.heading3", label: "Heading 3", category: "Format", action: () => dispatchFormatEvent("heading", { level: 3 }) },

    // ── Navigation ────────────────────────────────────────────────────────
    { id: "nav.go-to-line", label: "Go to Line", category: "Navigation", shortcut: `${modKey}+G`, hotkey: "mod+g", action: () => dialogs.setGotoLineOpen(true), hotkeyAction: () => dialogs.setGotoLineOpen((value) => !value) },
    { id: "nav.show-files", label: "Show Files Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("files"); } },
    { id: "nav.show-outline", label: "Show Outline Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("outline"); } },
    { id: "nav.show-diagnostics", label: "Show Diagnostics Panel", category: "Navigation", action: () => { workspace.setSidebarCollapsed(false); workspace.setSidebarTab("diagnostics"); } },
    { id: "nav.search", label: "Find in Files", category: "Navigation", shortcut: `${modKey}+Shift+F`, hotkey: "mod+shift+f", menuId: "edit_find", action: () => dialogs.setSearchOpen(true), hotkeyAction: () => dialogs.setSearchOpen((value) => !value) },
    { id: "nav.settings", label: "Settings", category: "Navigation", shortcut: `${modKey}+,`, hotkey: "mod+,", action: () => dialogs.setSettingsOpen(true), hotkeyAction: () => dialogs.setSettingsOpen((value) => !value) },

    // ── View ──────────────────────────────────────────────────────────────
    { id: "view.toggle-sidebar", label: "Toggle Sidebar", category: "View", shortcut: `${modKey}+\\`, hotkey: "mod+\\", menuId: "view_toggle_sidebar", action: () => workspace.setSidebarCollapsed((value) => !value) },
    { id: "view.toggle-sidenotes", label: "Toggle Sidenote Margin", category: "View", action: () => workspace.setSidenotesCollapsed((value) => !value) },
    { id: "view.toggle-theme", label: "Toggle Light/Dark Theme", category: "View", action: () => workspace.setTheme(workspace.resolvedTheme === "dark" ? "light" : "dark") },
    { id: "view.toggle-fps", label: "Toggle FPS Meter", category: "View", action: () => toggleFpsMeter() },

    // ── Insert ────────────────────────────────────────────────────────────
    { id: "insert.image", label: "Insert Image", category: "Insert", action: () => editor.handleInsertImage() },

    // ── Export ────────────────────────────────────────────────────────────
    { id: "export.html", label: "Export Current File to HTML", category: "Export", menuId: "file_export", action: handleExportHtml },
    { id: "export.batch-html", label: "Export All Files to HTML", category: "Export", action: handleBatchExportHtml },

    // ── Help ──────────────────────────────────────────────────────────────
    { id: "help.shortcuts", label: "Keyboard Shortcuts", category: "Help", shortcut: `${modKey}+/`, hotkey: "mod+/", menuId: "help_shortcuts", action: () => dialogs.setShortcutsOpen(true), hotkeyAction: () => dialogs.setShortcutsOpen((value) => !value) },
    { id: "help.about", label: "About Coflat", category: "Help", menuId: "help_about", action: () => dialogs.setAboutOpen(true) },

    // ── Recent files (palette only) ──────────────────────────────────────
    ...(workspace.recentFiles ?? []).map((path, i) => ({
      id: `file.recent-${i}`,
      label: `Open Recent: ${basename(path)}`,
      category: "File",
      action: () => { void editor.openFile(path); },
    })),
  ], [dialogs, editor, workspace, handleExportHtml, handleBatchExportHtml, handleSaveAs, onOpenFile, onQuit]);

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
  };
}
