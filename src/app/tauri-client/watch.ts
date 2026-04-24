import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

export const WATCH_STATUS_EVENT = "watch-status";

export type {
  NativeWatcherHealth,
  WatchDirectoryResult,
  WatcherHealthEvent,
} from "./command-contract";

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
