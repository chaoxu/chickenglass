import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

export type { WatchDirectoryResult } from "./command-contract";

const watchCommands = TAURI_COMMAND_CONTRACT.watch;

export const watchDirectoryCommand = tauriArgs(watchCommands.watchDirectory)(
  (path: string, generation: number, debounceMs: number) => ({
    path,
    generation,
    debounceMs,
  }),
);
export const unwatchDirectoryCommand = tauriArgs(watchCommands.unwatchDirectory)(
  (generation: number) => ({ generation }),
);
