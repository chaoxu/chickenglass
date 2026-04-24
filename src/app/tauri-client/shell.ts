import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

const shellCommands = TAURI_COMMAND_CONTRACT.shell;

export const openUrlCommand = tauriArgs(shellCommands.openUrl)((url: string) => ({ url }));
export const revealInFinderCommand = tauriArgs(shellCommands.revealInFinder)(
  (path: string) => ({ path }),
);
