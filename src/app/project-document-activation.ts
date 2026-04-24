import { findDefaultDocumentPath } from "./default-document-path";
import type { FileEntry } from "./file-manager";
import type { HotExitBackupStore } from "./hot-exit-backups";

export type ProjectDocumentActivationResult =
  | { readonly status: "none" }
  | { readonly status: "opened-default"; readonly path: string }
  | { readonly status: "opened-preferred"; readonly path: string }
  | { readonly status: "recovered"; readonly path: string }
  | { readonly status: "stale" };

export interface ProjectDocumentActivationOptions {
  readonly fileTree: FileEntry | null;
  readonly hotExitBackupStore?: HotExitBackupStore | null;
  readonly isCurrent?: () => boolean;
  readonly listChildren?: (path: string) => Promise<FileEntry[]>;
  readonly openFile: (path: string) => Promise<void>;
  readonly preferredDocumentPath?: string | null;
  readonly projectRoot: string | null;
  readonly restoreDocumentFromRecovery?: (
    path: string,
    content: string,
    options?: { baselineHash?: string },
  ) => Promise<void>;
  readonly signal?: AbortSignal;
}

function shouldRestoreBackup(name: string): boolean {
  return window.confirm(`Recover unsaved changes for "${name}"?`);
}

export async function activateProjectDocument({
  fileTree,
  hotExitBackupStore,
  isCurrent = () => true,
  listChildren,
  openFile,
  preferredDocumentPath,
  projectRoot,
  restoreDocumentFromRecovery,
  signal,
}: ProjectDocumentActivationOptions): Promise<ProjectDocumentActivationResult> {
  if (!isCurrent()) {
    return { status: "stale" };
  }

  if (hotExitBackupStore && projectRoot && restoreDocumentFromRecovery) {
    try {
      const summaries = await hotExitBackupStore.listBackups(projectRoot);
      if (!isCurrent()) {
        return { status: "stale" };
      }
      const recoverySummary = (preferredDocumentPath
        ? summaries.find((summary) => summary.path === preferredDocumentPath)
        : undefined) ?? summaries[0];
      if (recoverySummary && shouldRestoreBackup(recoverySummary.name)) {
        const backup = await hotExitBackupStore.readBackup(
          projectRoot,
          recoverySummary.path,
        );
        if (!isCurrent()) {
          return { status: "stale" };
        }
        if (backup) {
          await restoreDocumentFromRecovery(backup.path, backup.content, {
            baselineHash: backup.baselineHash,
          });
          return { status: "recovered", path: backup.path };
        }
      }
    } catch (error: unknown) {
      console.error("[session] failed to restore hot-exit backup:", error);
    }
  }

  if (preferredDocumentPath) {
    try {
      await openFile(preferredDocumentPath);
      if (!isCurrent()) {
        return { status: "stale" };
      }
      return { status: "opened-preferred", path: preferredDocumentPath };
    } catch (_error: unknown) {
      // The saved/explicit target may have been deleted; fall back to default.
    }
  }

  if (!fileTree || !isCurrent()) {
    return isCurrent() ? { status: "none" } : { status: "stale" };
  }

  const controller = new AbortController();
  const abortSignal = signal ?? controller.signal;
  const guardedListChildren = listChildren
    ? async (path: string): Promise<FileEntry[]> => {
        if (!isCurrent()) {
          controller.abort();
          return [];
        }
        const result = await listChildren(path);
        if (!isCurrent()) {
          controller.abort();
          return [];
        }
        return result;
      }
    : undefined;

  const defaultPath = await findDefaultDocumentPath(
    fileTree,
    guardedListChildren,
    abortSignal,
  );
  if (!isCurrent()) {
    return { status: "stale" };
  }
  if (!defaultPath) {
    return { status: "none" };
  }

  try {
    await openFile(defaultPath);
    if (!isCurrent()) {
      return { status: "stale" };
    }
    return { status: "opened-default", path: defaultPath };
  } catch (_error: unknown) {
    // Default file may have disappeared between tree load and open.
    return isCurrent() ? { status: "none" } : { status: "stale" };
  }
}
