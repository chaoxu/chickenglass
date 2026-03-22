import { useEffect } from "react";
import type { EditorMode } from "../../editor";

interface AppDebugWindow {
  __app?: {
    openFile: (path: string) => Promise<void>;
    saveFile: () => Promise<void>;
    closeFile: () => void;
    setMode: (mode: EditorMode) => void;
    getMode: () => EditorMode;
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
  }, [openFile, saveFile, closeFile, setMode, getMode]);
}
