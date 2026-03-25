/**
 * useMenuEvents — listens for native menu bar events from Tauri and dispatches
 * them to the appropriate frontend command handlers.
 *
 * In Tauri v2, the Rust backend emits a "menu-event" with the menu item ID as
 * payload (see src-tauri/src/menu.rs). This hook maps those IDs to the same
 * handlers used by the command palette and keyboard shortcuts.
 *
 * Format actions (bold, italic, etc.) are dispatched as `cf:format` CustomEvents
 * on `document`, matching the pattern used by the command palette.
 *
 * In browser mode (no Tauri), the hook is a no-op.
 */

import { useEffect, useRef } from "react";
import { isTauri } from "../../lib/tauri";
import { dispatchFormatEvent } from "../../constants/events";

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
 * Map from menu-event IDs that invoke a handler on MenuEventHandlers.
 * To add a new handler-based menu item, add an entry here.
 */
const handlerEventMap: Record<string, keyof MenuEventHandlers> = {
  // ── File ────────────────────────────────────────────────────────
  file_save: "onSave",
  file_save_as: "onSaveAs",
  file_close_tab: "onCloseTab",
  file_open_folder: "onOpenFolder",
  file_export: "onExport",

  // ── Edit (custom items — predefined Undo/Copy/etc. handled by OS)
  edit_find: "onShowSearch",

  // ── View ────────────────────────────────────────────────────────
  view_toggle_sidebar: "onToggleSidebar",

  // ── Help ────────────────────────────────────────────────────────
  help_about: "onAbout",
  help_shortcuts: "onShowShortcuts",
};

/**
 * Map from menu-event IDs that dispatch a cf:format event for CM6.
 * To add a new format action, add an entry here.
 */
const formatEventMap: Record<string, string> = {
  format_bold: "bold",
  format_italic: "italic",
  format_code: "code",
  format_strikethrough: "strikethrough",
  format_highlight: "highlight",
  format_link: "link",
};

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

    let cancelled = false;

    // Store the promise so cleanup can await it before calling unlisten.
    // Without this, if the effect is cleaned up before setup() resolves,
    // the Tauri listener registers after cleanup and is never removed.
    const setupPromise = (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return undefined;

      return listen<string>("menu-event", (event) => {
        const id = event.payload;
        const h = handlersRef.current;

        // Handler-based events (file, edit, view, help)
        const handlerKey = handlerEventMap[id];
        if (handlerKey) {
          h[handlerKey]?.();
          return;
        }

        // Format events dispatched as cf:format CustomEvents for CM6
        const formatAction = formatEventMap[id];
        if (formatAction) {
          dispatchFormatEvent(formatAction);
          return;
        }

        // file_new, file_open_file, file_quit, view_zoom_in, view_zoom_out,
        // view_focus_mode, view_debug, edit_replace: not yet wired to frontend
        // handlers. They can be added when those features are implemented.
      });
    })();

    return () => {
      cancelled = true;
      // Await the setup promise so we always call unlisten even if the effect
      // is torn down while the dynamic import is still in flight.
      void setupPromise.then((unlisten) => unlisten?.()).catch((e: unknown) => {
        console.error("[menu-events] teardown unlisten failed", e);
      });
    };
  }, []);
}
