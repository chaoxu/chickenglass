import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriCommandRaw } from "./make-command";

const perfCommands = TAURI_COMMAND_CONTRACT.perf;

export const getPerfSnapshotCommand = tauriCommandRaw(perfCommands.getPerfSnapshot);
export const clearPerfSnapshotCommand = tauriCommandRaw(perfCommands.clearPerfSnapshot);
