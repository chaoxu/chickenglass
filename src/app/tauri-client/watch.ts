import { tauriArgs } from "./make-command";

export interface WatchDirectoryResult {
  applied: boolean;
  root: string;
}

export const watchDirectoryCommand = tauriArgs<WatchDirectoryResult>("watch_directory")(
  (path: string, generation: number, debounceMs: number) => ({
    path,
    generation,
    debounceMs,
  }),
);
export const unwatchDirectoryCommand = tauriArgs<boolean>("unwatch_directory")(
  (generation: number) => ({ generation }),
);
