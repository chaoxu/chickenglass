import { isTauri } from "../lib/tauri";
import {
  deleteHotExitBackupCommand,
  listHotExitBackupsCommand,
  readHotExitBackupCommand,
  writeHotExitBackupCommand,
  type HotExitBackup,
  type HotExitBackupSummary,
} from "./tauri-client/recovery";

export interface HotExitBackupWrite {
  path: string;
  name: string;
  content: string;
  baselineHash?: string;
}

export interface HotExitBackupStore {
  writeBackup: (backup: HotExitBackupWrite) => Promise<HotExitBackupSummary>;
  listBackups: () => Promise<HotExitBackupSummary[]>;
  readBackup: (path: string) => Promise<HotExitBackup | null>;
  deleteBackup: (path: string) => Promise<void>;
}

export function createHotExitBackupStore(): HotExitBackupStore | null {
  if (!isTauri()) {
    return null;
  }
  return {
    writeBackup: ({ path, name, content, baselineHash }) =>
      writeHotExitBackupCommand(path, name, content, baselineHash),
    listBackups: () => listHotExitBackupsCommand(),
    readBackup: (path) => readHotExitBackupCommand(path),
    deleteBackup: (path) => deleteHotExitBackupCommand(path),
  };
}
