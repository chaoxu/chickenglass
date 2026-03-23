/**
 * useCommands — defines the standard command set for the command palette.
 *
 * Categories:
 *   File       — file operations (save, close, new file)
 *   Format     — text formatting (bold, italic, heading)
 *   Navigation — cursor/document navigation
 *   View       — view toggles (sidebar, theme)
 *
 * Each command carries an `action` callback. Callers pass handlers
 * for side effects (save, toggle sidebar, etc.) so the hook remains
 * stateless and easy to test.
 */

import { useMemo } from "react";
import type { PaletteCommand } from "../components/command-palette";
import { basename, modKey } from "../lib/utils";
import { FORMAT_EVENT } from "../../constants/events";

/** Handlers injected by the parent for commands that need side effects. */
export interface CommandHandlers {
  /** Save the active file. */
  onSave?: () => void;
  /** Save the active file under a new name/location. */
  onSaveAs?: () => void;
  /** Close the active tab. */
  onCloseTab?: () => void;
  /** Toggle the sidebar visibility. */
  onToggleSidebar?: () => void;
  /** Toggle the sidenote margin visibility. */
  onToggleSidenotes?: () => void;
  /** Switch sidebar to the files panel. */
  onShowFiles?: () => void;
  /** Switch sidebar to the outline panel. */
  onShowOutline?: () => void;
  /** Toggle between light and dark theme. */
  onToggleTheme?: () => void;
  /** Jump to a specific line number (prompts via browser dialog). */
  onGoToLine?: () => void;
  /** Show the About dialog. */
  onAbout?: () => void;
  /** Open keyboard shortcuts reference. */
  onShowShortcuts?: () => void;
  /** Open settings dialog. */
  onShowSettings?: () => void;
  /** Open search panel. */
  onShowSearch?: () => void;
  /** Open folder dialog (Tauri: native dialog, browser: no-op). */
  onOpenFolder?: () => void;
  /** Open a recently opened file by path. */
  onOpenRecentFile?: (path: string) => void;
  /** Recent file paths for dynamic command generation. */
  recentFiles?: readonly string[];
  /** Export current file to HTML. */
  onExportHtml?: () => void;
  /** Batch export all project files to HTML. */
  onBatchExportHtml?: () => void;
  /** Insert an image from a file picker. */
  onInsertImage?: () => void;
}

/** Dispatch a formatting event to the document for CM6 to handle. */
export function dispatchFormatEvent(type: string, detail?: Record<string, unknown>): void {
  document.dispatchEvent(new CustomEvent(FORMAT_EVENT, { detail: { type, ...detail } }));
}

/**
 * Returns the standard command list for the command palette.
 *
 * Re-computed only when `handlers` reference changes.
 */
export function useCommands(handlers: CommandHandlers): PaletteCommand[] {
  return useMemo(
    () => [
      // ── File ────────────────────────────────────────────────────────────────
      {
        id: "file.save",
        label: "Save File",
        category: "File",
        shortcut: `${modKey}+S`,
        action: () => handlers.onSave?.(),
      },
      {
        id: "file.save-as",
        label: "Save As...",
        category: "File",
        shortcut: `${modKey}+Shift+S`,
        action: () => handlers.onSaveAs?.(),
      },
      {
        id: "file.close-tab",
        label: "Close Tab",
        category: "File",
        shortcut: `${modKey}+W`,
        action: () => handlers.onCloseTab?.(),
      },
      {
        id: "file.open-folder",
        label: "Open Folder...",
        category: "File",
        action: () => handlers.onOpenFolder?.(),
      },

      // ── Recent files (dynamic) ────────────────────────────────────────────
      ...(handlers.recentFiles ?? []).map((path, i) => ({
        id: `file.recent-${i}`,
        label: `Open Recent: ${basename(path)}`,
        category: "File",
        action: () => handlers.onOpenRecentFile?.(path),
      })),

      // ── Format ──────────────────────────────────────────────────────────────
      {
        id: "format.bold",
        label: "Toggle Bold",
        category: "Format",
        shortcut: `${modKey}+B`,
        action: () => dispatchFormatEvent("bold"),
      },
      {
        id: "format.italic",
        label: "Toggle Italic",
        category: "Format",
        shortcut: `${modKey}+I`,
        action: () => dispatchFormatEvent("italic"),
      },
      {
        id: "format.heading1",
        label: "Heading 1",
        category: "Format",
        action: () => dispatchFormatEvent("heading", { level: 1 }),
      },
      {
        id: "format.heading2",
        label: "Heading 2",
        category: "Format",
        action: () => dispatchFormatEvent("heading", { level: 2 }),
      },
      {
        id: "format.heading3",
        label: "Heading 3",
        category: "Format",
        action: () => dispatchFormatEvent("heading", { level: 3 }),
      },

      // ── Navigation ──────────────────────────────────────────────────────────
      {
        id: "nav.go-to-line",
        label: "Go to Line",
        category: "Navigation",
        shortcut: `${modKey}+G`,
        action: () => handlers.onGoToLine?.(),
      },
      {
        id: "nav.show-files",
        label: "Show Files Panel",
        category: "Navigation",
        action: () => handlers.onShowFiles?.(),
      },
      {
        id: "nav.show-outline",
        label: "Show Outline Panel",
        category: "Navigation",
        action: () => handlers.onShowOutline?.(),
      },

      // ── View ────────────────────────────────────────────────────────────────
      {
        id: "view.toggle-sidebar",
        label: "Toggle Sidebar",
        category: "View",
        shortcut: `${modKey}+\\`,
        action: () => handlers.onToggleSidebar?.(),
      },
      {
        id: "view.toggle-sidenotes",
        label: "Toggle Sidenote Margin",
        category: "View",
        action: () => handlers.onToggleSidenotes?.(),
      },
      {
        id: "view.toggle-theme",
        label: "Toggle Light/Dark Theme",
        category: "View",
        action: () => handlers.onToggleTheme?.(),
      },
      {
        id: "nav.search",
        label: "Find in Files",
        shortcut: `${modKey}+Shift+F`,
        category: "Navigation",
        action: () => handlers.onShowSearch?.(),
      },
      {
        id: "nav.settings",
        label: "Settings",
        shortcut: `${modKey}+,`,
        category: "Navigation",
        action: () => handlers.onShowSettings?.(),
      },
      // ── Insert ──────────────────────────────────────────────────────────────
      {
        id: "insert.image",
        label: "Insert Image",
        category: "Insert",
        action: () => handlers.onInsertImage?.(),
      },

      // ── Export ──────────────────────────────────────────────────────────────
      {
        id: "export.html",
        label: "Export Current File to HTML",
        category: "Export",
        action: () => handlers.onExportHtml?.(),
      },
      {
        id: "export.batch-html",
        label: "Export All Files to HTML",
        category: "Export",
        action: () => handlers.onBatchExportHtml?.(),
      },

      {
        id: "help.shortcuts",
        label: "Keyboard Shortcuts",
        shortcut: `${modKey}+/`,
        category: "Help",
        action: () => handlers.onShowShortcuts?.(),
      },
      {
        id: "help.about",
        label: "About Coflat",
        category: "Help",
        action: () => handlers.onAbout?.(),
      },
    ],
    [handlers],
  );
}
