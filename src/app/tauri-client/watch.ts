import { invokeWithPerf } from "../perf";

export function watchDirectoryCommand(path: string, generation: number): Promise<boolean> {
  return invokeWithPerf<boolean>("watch_directory", { path, generation });
}

export function unwatchDirectoryCommand(generation: number): Promise<boolean> {
  return invokeWithPerf<boolean>("unwatch_directory", { generation });
}
