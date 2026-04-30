/**
 * dev-settings — Zustand store for session-only developer diagnostic toggles.
 *
 * These are separate from user-facing Settings (localStorage-backed product
 * preferences). Dev settings are ephemeral: they reset on page reload and
 * are only meaningful in dev/debug contexts.
 *
 * Downstream consumers (perf panel, FPS meter, future tree inspector) subscribe
 * via fine-grained selectors so toggling one diagnostic does not rerender
 * unrelated UI.
 */

import { create } from "zustand";

export interface DevSettings {
  /** Show the Lezer syntax-tree inspector panel. */
  treeView: boolean;
  /** Show the performance debug panel. */
  perfPanel: boolean;
  /** Show the FPS counter in the status bar. */
  fpsCounter: boolean;
  /** Log dispatched commands to the console. */
  commandLogging: boolean;
  /** Trace focus/blur events across editor surfaces. */
  focusTracing: boolean;
  /** Keep selection highlight visible when the editor is blurred. */
  selectionAlwaysOn: boolean;
}

export interface DevSettingsStore extends DevSettings {
  /** Toggle a single boolean flag and return the new value. */
  toggle: (key: keyof DevSettings) => boolean;
  /** Set a single boolean flag. */
  set: (key: keyof DevSettings, value: boolean) => void;
}

export const selectAnyDebugActive = (s: DevSettings) =>
  s.treeView || s.perfPanel || s.fpsCounter || s.commandLogging || s.focusTracing;

export const useDevSettings = create<DevSettingsStore>()((setState, getState) => ({
  treeView: false,
  perfPanel: false,
  fpsCounter: false,
  // Session recording hooks run on input/click paths. Keep them explicitly
  // opt-in so normal browser, preview, and Tauri editing stays on the fast path.
  commandLogging: false,
  focusTracing: false,
  selectionAlwaysOn: false,

  toggle: (key) => {
    const next = !getState()[key];
    setState({ [key]: next });
    return next;
  },

  set: (key, value) => {
    setState({ [key]: value });
  },
}));
