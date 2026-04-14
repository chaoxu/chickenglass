import type { PaletteCommand } from "../components/command-palette";
import type { HotkeyBinding } from "./use-hotkeys";

/**
 * A single command definition that serves as the source of truth for the
 * command palette, keyboard shortcuts, and native menu event wiring.
 */
export interface CommandDef {
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
export function toPaletteCommands(defs: CommandDef[]): PaletteCommand[] {
  return defs.map(({ id, label, category, shortcut, action }) => ({
    id, label, category, shortcut, action,
  }));
}

/** Extract HotkeyBinding[] from entries that declare a hotkey. */
export function toHotkeyBindings(defs: CommandDef[]): HotkeyBinding[] {
  const result: HotkeyBinding[] = [];
  for (const d of defs) {
    if (d.hotkey) {
      result.push({ key: d.hotkey, handler: d.hotkeyAction ?? d.action });
    }
  }
  return result;
}

/** Extract a menuId → handler map from entries that declare a menuId. */
export function toMenuHandlers(defs: CommandDef[]): Record<string, () => void> {
  const map: Record<string, () => void> = {};
  for (const d of defs) {
    if (d.menuId) map[d.menuId] = d.action;
  }
  return map;
}
