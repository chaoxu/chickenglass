import { invokeWithPerf } from "../perf";

export function watchDirectoryCommand(path: string): Promise<void> {
  return invokeWithPerf("watch_directory", { path });
}

export function unwatchDirectoryCommand(): Promise<void> {
  return invokeWithPerf("unwatch_directory");
}
