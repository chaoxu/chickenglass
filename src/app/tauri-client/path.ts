import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

const pathCommands = TAURI_COMMAND_CONTRACT.path;

export const toProjectRelativePathCommand = tauriArgs(
  pathCommands.toProjectRelativePath,
)((path: string) => ({ path }));

export const canonicalizeProjectRootCommand = tauriArgs(
  pathCommands.canonicalizeProjectRoot,
)((path: string) => ({ path }));
