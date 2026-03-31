import { useEffect } from "react";
import type { EditorMode } from "../../editor";
import { isTauri } from "../../lib/tauri";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  printPerfSummary,
  togglePerfPanel,
} from "../perf";
import { toggleFpsMeter, stopFpsMeter } from "../fps-meter";
import {
  debugEmitFileChangedCommand,
  debugGetNativeStateCommand,
  debugListWindowsCommand,
} from "../tauri-client/debug";

interface DebugDocumentState {
  path: string;
  name: string;
  dirty: boolean;
}

interface TauriSmokeWindowState {
  projectRoot: string | null;
  currentDocument: DebugDocumentState | null;
  dirty: boolean;
  startupComplete: boolean;
  restoredProjectRoot: string | null;
  mode: EditorMode;
  backendProjectRoot: string | null;
  backendProjectGeneration: number | null;
  watcherRoot: string | null;
  watcherGeneration: number | null;
  watcherActive: boolean;
  lastFocusedWindow: string | null;
}

interface AppDebugDeps {
  openProject: (path: string) => Promise<boolean>;
  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  closeFile: () => void;
  requestNativeClose: () => Promise<void>;
  setMode: (mode: EditorMode) => void;
  getMode: () => EditorMode;
  projectRoot: string | null;
  currentDocument: DebugDocumentState | null;
  hasDirtyDocument: boolean;
  startupComplete: boolean;
  restoredProjectRoot: string | null;
}

export function useAppDebug({
  openProject,
  openFile,
  saveFile,
  closeFile,
  requestNativeClose,
  setMode,
  getMode,
  projectRoot,
  currentDocument,
  hasDirtyDocument,
  startupComplete,
  restoredProjectRoot,
}: AppDebugDeps): void {
  useEffect(() => {
    window.__app = {
      openFile,
      saveFile,
      closeFile,
      setMode,
      getMode,
    };
    window.__cfDebug = {
      perfSummary: getCombinedPerfSnapshot,
      printPerfSummary,
      clearPerf: clearCombinedPerf,
      togglePerfPanel,
      toggleFps: toggleFpsMeter,
    };
    if (import.meta.env.DEV && isTauri()) {
      window.__tauriSmoke = {
        openProject,
        openFile,
        requestNativeClose,
        listWindows: () => debugListWindowsCommand(),
        getWindowState: async (): Promise<TauriSmokeWindowState> => {
          const nativeState = await debugGetNativeStateCommand();
          return {
            projectRoot,
            currentDocument,
            dirty: hasDirtyDocument,
            startupComplete,
            restoredProjectRoot,
            mode: getMode(),
            backendProjectRoot: nativeState.project_root,
            backendProjectGeneration: nativeState.project_generation,
            watcherRoot: nativeState.watcher_root,
            watcherGeneration: nativeState.watcher_generation,
            watcherActive: nativeState.watcher_active,
            lastFocusedWindow: nativeState.last_focused_window,
          };
        },
        simulateExternalChange: (relativePath: string) => debugEmitFileChangedCommand(relativePath),
      };
    } else {
      delete window.__tauriSmoke;
    }
    return () => {
      // Clear debug globals on unmount / HMR so stale closures are not left
      // on window between hot-reloads or component teardowns.
      stopFpsMeter();
      delete window.__app;
      delete window.__cfDebug;
      delete window.__tauriSmoke;
    };
  }, [
    openProject,
    openFile,
    saveFile,
    closeFile,
    requestNativeClose,
    setMode,
    getMode,
    projectRoot,
    currentDocument,
    hasDirtyDocument,
    startupComplete,
    restoredProjectRoot,
  ]);
}
