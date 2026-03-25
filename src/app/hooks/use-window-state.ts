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

import { useState, useCallback } from "react";
import {
  loadWindowState,
  saveWindowState,
  buildWindowState,
  type WindowState,
  type CurrentDocumentState,
  type SidebarSectionState,
} from "../window-state";

export interface UseWindowStateReturn {
  /** The currently loaded window state. */
  windowState: WindowState;
  /**
   * Persist a partial update.  Merges with current state before writing.
   */
  saveState: (patch: Partial<{
    currentDocument: CurrentDocumentState | null;
    projectRoot: string | null;
    sidebarWidth: number;
    sidebarSections: SidebarSectionState[];
  }>) => void;
  /** Reload from localStorage (useful after external writes). */
  reloadState: () => void;
}

export function useWindowState(): UseWindowStateReturn {
  const [windowState, setWindowState] = useState<WindowState>(loadWindowState);

  const saveState = useCallback(
    (patch: Partial<{
      currentDocument: CurrentDocumentState | null;
      projectRoot: string | null;
      sidebarWidth: number;
      sidebarSections: SidebarSectionState[];
    }>) => {
      setWindowState((prev) => {
        const next = buildWindowState({
          currentDocument: patch.currentDocument !== undefined ? patch.currentDocument : prev.currentDocument,
          projectRoot: patch.projectRoot !== undefined ? patch.projectRoot : prev.projectRoot,
          sidebarWidth: patch.sidebarWidth ?? prev.sidebarWidth,
          sidebarSections: patch.sidebarSections ?? prev.sidebarSections,
        });
        saveWindowState(next);
        return next;
      });
    },
    [],
  );

  const reloadState = useCallback(() => {
    setWindowState(loadWindowState());
  }, []);

  return { windowState, saveState, reloadState };
}
