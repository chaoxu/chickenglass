import { TAURI_COMMANDS } from "./bridge-metadata";
import { tauriCommand, tauriArgs } from "./make-command";

export interface NativeWindowDebugInfo {
  label: string;
  focused: boolean;
}

export interface NativeDebugState {
  projectRoot: string | null;
  projectGeneration: number | null;
  watcherRoot: string | null;
  watcherGeneration: number | null;
  watcherActive: boolean;
  lastFocusedWindow: string | null;
}

export const debugListWindowsCommand = tauriCommand<NativeWindowDebugInfo[]>(TAURI_COMMANDS.debugListWindows);
export const debugGetNativeStateCommand = tauriCommand<NativeDebugState>(TAURI_COMMANDS.debugGetNativeState);
export const debugEmitFileChangedCommand = tauriArgs<undefined>(TAURI_COMMANDS.debugEmitFileChanged)(
  (relativePath: string, treeChanged?: boolean) =>
    treeChanged === undefined ? { relativePath } : { relativePath, treeChanged },
);
