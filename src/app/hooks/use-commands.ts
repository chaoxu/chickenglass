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
import { modKey } from "../lib/utils";

/** Handlers injected by the parent for commands that need side effects. */
export interface CommandHandlers {
  /** Save the active file. */
  onSave?: () => void;
  /** Close the active tab. */
  onCloseTab?: () => void;
  /** Toggle the sidebar visibility. */
  onToggleSidebar?: () => void;
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
}

/** Dispatch a formatting event to the document for CM6 to handle. */
function dispatchFormatEvent(type: string, detail?: Record<string, unknown>): void {
  document.dispatchEvent(new CustomEvent("cg:format", { detail: { type, ...detail } }));
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
        id: "file.close-tab",
        label: "Close Tab",
        category: "File",
        shortcut: `${modKey}+W`,
        action: () => handlers.onCloseTab?.(),
      },

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
      {
        id: "help.shortcuts",
        label: "Keyboard Shortcuts",
        shortcut: `${modKey}+/`,
        category: "Help",
        action: () => handlers.onShowShortcuts?.(),
      },
      {
        id: "help.about",
        label: "About Chickenglass",
        category: "Help",
        action: () => handlers.onAbout?.(),
      },
    ],
    [handlers],
  );
}
