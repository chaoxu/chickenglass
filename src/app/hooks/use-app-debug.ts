import { useEffect } from "react";
import type { EditorMode } from "../../editor";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  printPerfSummary,
  togglePerfPanel,
} from "../perf";

interface AppDebugWindow {
  __app?: {
    openFile: (path: string) => Promise<void>;
    saveFile: () => Promise<void>;
    closeFile: () => void;
    setMode: (mode: EditorMode) => void;
    getMode: () => EditorMode;
  };
  __cfDebug?: {
    perfSummary: () => Promise<unknown>;
    printPerfSummary: () => Promise<unknown>;
    clearPerf: () => Promise<void>;
    togglePerfPanel: () => void;
  };
}

interface AppDebugDeps {
  openFile: (path: string) => Promise<void>;
  saveFile: () => Promise<void>;
  closeFile: () => void;
  setMode: (mode: EditorMode) => void;
  getMode: () => EditorMode;
}

export function useAppDebug({
  openFile,
  saveFile,
  closeFile,
  setMode,
  getMode,
}: AppDebugDeps): void {
  useEffect(() => {
    const debugWindow = window as unknown as AppDebugWindow;
    debugWindow.__app = {
      openFile,
      saveFile,
      closeFile,
      setMode,
      getMode,
    };
    debugWindow.__cfDebug = {
      perfSummary: getCombinedPerfSnapshot,
      printPerfSummary,
      clearPerf: clearCombinedPerf,
      togglePerfPanel,
    };
    return () => {
      // Clear debug globals on unmount / HMR so stale closures are not left
      // on window between hot-reloads or component teardowns.
      delete debugWindow.__app;
      delete debugWindow.__cfDebug;
    };
  }, [openFile, saveFile, closeFile, setMode, getMode]);
}
