import { TAURI_COMMANDS } from "./bridge-metadata";
import { tauriArgs } from "./make-command";

export const watchDirectoryCommand = tauriArgs<boolean>(TAURI_COMMANDS.watchDirectory)((path: string, generation: number) => ({ path, generation }));
export const unwatchDirectoryCommand = tauriArgs<boolean>(TAURI_COMMANDS.unwatchDirectory)((generation: number) => ({ generation }));
