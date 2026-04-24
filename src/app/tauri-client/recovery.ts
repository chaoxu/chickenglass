import { TAURI_COMMAND_CONTRACT } from "./command-contract";
import { tauriArgs, tauriCommand } from "./make-command";

export type {
  HotExitBackup,
  HotExitBackupSummary,
} from "./command-contract";

const recoveryCommands = TAURI_COMMAND_CONTRACT.recovery;

export const writeHotExitBackupCommand = tauriArgs(
  recoveryCommands.writeHotExitBackup,
)((
  path: string,
  name: string,
  content: string,
  baselineHash?: string,
) => ({
  path,
  name,
  content,
  baselineHash,
}));

export const listHotExitBackupsCommand = tauriCommand(
  recoveryCommands.listHotExitBackups,
);

export const readHotExitBackupCommand = tauriArgs(
  recoveryCommands.readHotExitBackup,
)((path: string) => ({ path }));

export const deleteHotExitBackupCommand = tauriArgs(
  recoveryCommands.deleteHotExitBackup,
)((path: string) => ({ path }));
