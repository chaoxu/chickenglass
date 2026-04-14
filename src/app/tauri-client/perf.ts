import type { PerfSnapshot } from "../perf";
import { TAURI_COMMANDS } from "./bridge-metadata";
import { tauriCommandRaw } from "./make-command";

export const getPerfSnapshotCommand = tauriCommandRaw<PerfSnapshot>(TAURI_COMMANDS.getPerfSnapshot);
export const clearPerfSnapshotCommand = tauriCommandRaw<undefined>(TAURI_COMMANDS.clearPerfSnapshot);
