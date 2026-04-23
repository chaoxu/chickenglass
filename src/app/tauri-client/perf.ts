import type { PerfSnapshot } from "../../lib/perf";
import { tauriCommandRaw } from "./make-command";

export const getPerfSnapshotCommand = tauriCommandRaw<PerfSnapshot>("get_perf_snapshot");
export const clearPerfSnapshotCommand = tauriCommandRaw<undefined>("clear_perf_snapshot");
