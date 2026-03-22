import type { PerfSnapshot } from "../perf";
import { invokeTauriCommandRaw } from "./core";

export function getPerfSnapshotCommand(): Promise<PerfSnapshot> {
  return invokeTauriCommandRaw<PerfSnapshot>("get_perf_snapshot");
}

export async function clearPerfSnapshotCommand(): Promise<void> {
  await invokeTauriCommandRaw("clear_perf_snapshot");
}
