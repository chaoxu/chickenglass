import { tauriArgs } from "./make-command";

export const watchDirectoryCommand = tauriArgs<boolean>("watch_directory")((path: string, generation: number, debounceMs: number) => ({ path, generation, debounceMs }));
export const unwatchDirectoryCommand = tauriArgs<boolean>("unwatch_directory")((generation: number) => ({ generation }));
