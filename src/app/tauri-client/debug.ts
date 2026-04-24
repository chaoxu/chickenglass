import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs, tauriCommand } from "./make-command";

export type {
  NativeDebugState,
  NativeWindowDebugInfo,
} from "./command-contract";

const debugCommands = TAURI_COMMAND_CONTRACT.debug;

export const debugListWindowsCommand = tauriCommand(debugCommands.debugListWindows);
export const debugGetNativeStateCommand = tauriCommand(debugCommands.debugGetNativeState);
export const debugEmitFileChangedCommand = tauriArgs(debugCommands.debugEmitFileChanged)(
  (relativePath: string, treeChanged?: boolean) =>
    treeChanged === undefined ? { relativePath } : { relativePath, treeChanged },
);
