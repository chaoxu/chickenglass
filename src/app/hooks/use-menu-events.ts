/**
 * useMenuEvents — listens for native menu bar events from Tauri and dispatches
 * them to the appropriate frontend command handlers.
 *
 * In Tauri v2, the Rust backend emits a "menu-event" with the menu item ID as
 * payload (see src-tauri/src/menu.rs). This hook maps those IDs to the same
 * handlers used by the command palette and keyboard shortcuts.
 *
 * Format actions (bold, italic, etc.) are dispatched as `cg:format` CustomEvents
 * on `document`, matching the pattern used by the command palette.
 *
 * In browser mode (no Tauri), the hook is a no-op.
 */

import { useEffect, useRef } from "react";
import { isTauri } from "../tauri-fs";
import { dispatchFormatEvent } from "./use-commands";

/** Handlers for native menu actions that require app-level state. */
export interface MenuEventHandlers {
  onSave?: () => void;
  onSaveAs?: () => void;
  onCloseTab?: () => void;
  onToggleSidebar?: () => void;
  onShowSearch?: () => void;
  onShowShortcuts?: () => void;
  onAbout?: () => void;
  onOpenFolder?: () => void;
  onExport?: () => void;
}

/**
 * Listen for native Tauri menu events and dispatch to handlers.
 *
 * Uses a ref to avoid re-subscribing on every handler change.
 * The listener is set up once on mount and torn down on unmount.
 */
export function useMenuEvents(handlers: MenuEventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const setup = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      unlisten = await listen<string>("menu-event", (event) => {
        const id = event.payload;
        const h = handlersRef.current;

        switch (id) {
          // ── File ────────────────────────────────────────────────────────
          case "file_save":
            h.onSave?.();
            break;
          case "file_save_as":
            h.onSaveAs?.();
            break;
          case "file_close_tab":
            h.onCloseTab?.();
            break;
          case "file_open_folder":
            h.onOpenFolder?.();
            break;
          case "file_export":
            h.onExport?.();
            break;

          // ── Edit (custom items — predefined Undo/Copy/etc. handled by OS)
          case "edit_find":
            h.onShowSearch?.();
            break;

          // ── View ────────────────────────────────────────────────────────
          case "view_toggle_sidebar":
            h.onToggleSidebar?.();
            break;

          // ── Format (dispatched as cg:format events for CM6) ─────────────
          case "format_bold":
            dispatchFormatEvent("bold");
            break;
          case "format_italic":
            dispatchFormatEvent("italic");
            break;
          case "format_code":
            dispatchFormatEvent("code");
            break;
          case "format_strikethrough":
            dispatchFormatEvent("strikethrough");
            break;
          case "format_highlight":
            dispatchFormatEvent("highlight");
            break;
          case "format_link":
            dispatchFormatEvent("link");
            break;

          // ── Help ────────────────────────────────────────────────────────
          case "help_about":
            h.onAbout?.();
            break;
          case "help_shortcuts":
            h.onShowShortcuts?.();
            break;

          // file_new, file_open_file, file_quit, view_zoom_in, view_zoom_out,
          // view_focus_mode, view_debug, edit_replace: not yet wired to frontend
          // handlers. They can be added when those features are implemented.
          default:
            break;
        }
      });
    };

    void setup();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
