/**
 * useWindowState — React hook for persisting and restoring window state.
 *
 * Wraps the vanilla window-state.ts module with a React interface.
 * Persists: open tab list, active tab path, sidebar collapsed state,
 * and sidebar width.
 *
 * Call `saveState(patch)` to write a partial update to localStorage;
 * the initial state is loaded synchronously from localStorage on first render.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  saveWindowState,
  buildWindowState,
  getWindowStateSnapshot,
  reloadWindowStateSnapshot,
  subscribeWindowState,
  type WindowState,
  type CurrentDocumentState,
  type WorkspaceLayoutState,
} from "../window-state";

export interface UseWindowStateReturn {
  /** The currently loaded window state. */
  windowState: WindowState;
  /**
   * Persist a partial update.  Merges with current state before writing.
   */
  saveState: (patch: Partial<{
    currentDocument: CurrentDocumentState | null;
    layout: WorkspaceLayoutState;
    projectRoot: string | null;
  }>) => void;
  /** Reload from localStorage (useful after external writes). */
  reloadState: () => void;
}

export function useWindowState(): UseWindowStateReturn {
  const windowState = useSyncExternalStore(
    subscribeWindowState,
    getWindowStateSnapshot,
    getWindowStateSnapshot,
  );

  const saveState = useCallback(
    (patch: Partial<{
      currentDocument: CurrentDocumentState | null;
      layout: WorkspaceLayoutState;
      projectRoot: string | null;
    }>) => {
      const prev = getWindowStateSnapshot();
      const next = buildWindowState({
        currentDocument: patch.currentDocument !== undefined ? patch.currentDocument : prev.currentDocument,
        layout: patch.layout ?? prev.layout,
        projectRoot: patch.projectRoot !== undefined ? patch.projectRoot : prev.projectRoot,
      });
      saveWindowState(next);
    },
    [],
  );

  const reloadState = useCallback(() => {
    reloadWindowStateSnapshot();
  }, []);

  return { windowState, saveState, reloadState };
}
