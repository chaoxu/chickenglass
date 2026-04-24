import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs } from "./make-command";

export type {
  HotExitBackup,
  HotExitBackupSummary,
} from "./command-contract";

const recoveryCommands = TAURI_COMMAND_CONTRACT.recovery;

export const writeHotExitBackupCommand = tauriArgs(
  recoveryCommands.writeHotExitBackup,
)((
  projectRoot: string,
  path: string,
  name: string,
  content: string,
  baselineHash?: string,
) => ({
  projectRoot,
  path,
  name,
  content,
  baselineHash,
}));

export const listHotExitBackupsCommand = tauriArgs(
  recoveryCommands.listHotExitBackups,
)((projectRoot: string) => ({ projectRoot }));

export const readHotExitBackupCommand = tauriArgs(
  recoveryCommands.readHotExitBackup,
)((projectRoot: string, path: string) => ({ projectRoot, path }));

export const deleteHotExitBackupCommand = tauriArgs(
  recoveryCommands.deleteHotExitBackup,
)((projectRoot: string, path: string) => ({ projectRoot, path }));
