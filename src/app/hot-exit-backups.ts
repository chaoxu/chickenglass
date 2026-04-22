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
  projectRoot: string;
  path: string;
  name: string;
  content: string;
  baselineHash?: string;
}

export interface HotExitBackupStore {
  writeBackup: (backup: HotExitBackupWrite) => Promise<HotExitBackupSummary>;
  listBackups: (projectRoot: string) => Promise<HotExitBackupSummary[]>;
  readBackup: (projectRoot: string, path: string) => Promise<HotExitBackup | null>;
  deleteBackup: (projectRoot: string, path: string) => Promise<void>;
}

export function createHotExitBackupStore(): HotExitBackupStore | null {
  if (!isTauri()) {
    return null;
  }
  return {
    writeBackup: ({ projectRoot, path, name, content, baselineHash }) =>
      writeHotExitBackupCommand(projectRoot, path, name, content, baselineHash),
    listBackups: (projectRoot) => listHotExitBackupsCommand(projectRoot),
    readBackup: (projectRoot, path) => readHotExitBackupCommand(projectRoot, path),
    deleteBackup: (projectRoot, path) =>
      deleteHotExitBackupCommand(projectRoot, path),
  };
}
