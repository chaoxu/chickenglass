import { tauriArgs } from "./make-command";

export interface HotExitBackup {
  version: 1;
  id: string;
  projectRoot: string;
  projectKey: string;
  path: string;
  name: string;
  content: string;
  contentHash: string;
  baselineHash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HotExitBackupSummary {
  id: string;
  projectRoot: string;
  projectKey: string;
  path: string;
  name: string;
  contentHash: string;
  baselineHash?: string;
  updatedAt: number;
  bytes: number;
}

export const writeHotExitBackupCommand = tauriArgs<HotExitBackupSummary>(
  "write_hot_exit_backup",
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

export const listHotExitBackupsCommand = tauriArgs<HotExitBackupSummary[]>(
  "list_hot_exit_backups",
)((projectRoot: string) => ({ projectRoot }));

export const readHotExitBackupCommand = tauriArgs<HotExitBackup | null>(
  "read_hot_exit_backup",
)((projectRoot: string, path: string) => ({ projectRoot, path }));

export const deleteHotExitBackupCommand = tauriArgs<undefined>(
  "delete_hot_exit_backup",
)((projectRoot: string, path: string) => ({ projectRoot, path }));
