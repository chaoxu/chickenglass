import { useEffect } from "react";
import type { EditorMode } from "../../editor";
import {
  clearCombinedPerf,
  getCombinedPerfSnapshot,
  printPerfSummary,
  togglePerfPanel,
} from "../perf";

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
    };
    return () => {
      // Clear debug globals on unmount / HMR so stale closures are not left
      // on window between hot-reloads or component teardowns.
      delete window.__app;
      delete window.__cfDebug;
    };
  }, [openFile, saveFile, closeFile, setMode, getMode]);
}
