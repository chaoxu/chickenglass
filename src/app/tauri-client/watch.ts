import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

export type { WatchDirectoryResult } from "./command-contract";

const watchCommands = TAURI_COMMAND_CONTRACT.watch;

export const watchDirectoryCommand = tauriArgs(watchCommands.watchDirectory)(
  (generation: number, debounceMs: number) => ({
    generation,
    debounceMs,
  }),
);
export const unwatchDirectoryCommand = tauriArgs(watchCommands.unwatchDirectory)(
  (generation: number) => ({ generation }),
);
