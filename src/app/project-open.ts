import type { FileEntry } from "./file-manager";
import type { HotExitBackupStore } from "./hot-exit-backups";
import { activateProjectDocument } from "./project-document-activation";
import type { ProjectOpenResult } from "./project-open-result";

export interface OpenProjectInCurrentWindowOptions {
  projectRoot: string;
  initialPath?: string;
  currentProjectRoot: string | null;
  nextRequestId: () => number;
  isRequestCurrent: (requestId: number) => boolean;
  cancelPendingOpenFile: () => void;
  closeCurrentFile: () => Promise<boolean>;
  probeProjectRoot: (path: string) => Promise<ProjectOpenResult | null>;
  openProjectRoot: (
    path: string,
    preloaded?: ProjectOpenResult | null,
  ) => Promise<ProjectOpenResult | null>;
  canonicalizeProjectRoot?: (path: string) => Promise<string>;
  openFile: (path: string) => Promise<void>;
  restoreDocumentFromRecovery?: (
    path: string,
    content: string,
    options?: { baselineHash?: string },
  ) => Promise<void>;
  hotExitBackupStore?: HotExitBackupStore | null;
  /** When provided, default-doc search loads subdirectories lazily. */
  listChildren?: (path: string) => Promise<FileEntry[]>;
  /** When provided, cancels the in-flight default-doc search early. */
  signal?: AbortSignal;
}

export async function openProjectInCurrentWindow({
  projectRoot,
  initialPath,
  currentProjectRoot,
  nextRequestId,
  isRequestCurrent,
  cancelPendingOpenFile,
  closeCurrentFile,
  probeProjectRoot,
  openProjectRoot,
  canonicalizeProjectRoot,
  openFile,
  restoreDocumentFromRecovery,
  hotExitBackupStore,
  listChildren,
  signal,
}: OpenProjectInCurrentWindowOptions): Promise<boolean> {
  const requestId = nextRequestId();

  // A newer project-open request must be able to invalidate any older
  // in-flight openFile(), even if the newer request later resolves as a
  // same-project no-op.
  cancelPendingOpenFile();

  const candidateProjectRoot = canonicalizeProjectRoot
    ? await canonicalizeProjectRoot(projectRoot)
    : projectRoot;
  if (!isRequestCurrent(requestId)) {
    return false;
  }

  const replacingProject = currentProjectRoot !== candidateProjectRoot;
  if (!replacingProject) {
    if (!initialPath) {
      return true;
    }
    await openFile(initialPath);
    return isRequestCurrent(requestId);
  }

  const targetProject = await probeProjectRoot(projectRoot);
  if (!targetProject || !isRequestCurrent(requestId)) {
    return false;
  }

  const closed = await closeCurrentFile();
  if (!isRequestCurrent(requestId)) {
    return false;
  }
  if (!closed) {
    return false;
  }

  const result = await openProjectRoot(projectRoot, targetProject);
  if (!result || !isRequestCurrent(requestId)) {
    return false;
  }

  await activateProjectDocument({
    fileTree: result.tree,
    hotExitBackupStore,
    isCurrent: () => isRequestCurrent(requestId),
    listChildren,
    openFile,
    preferredDocumentPath: initialPath ?? null,
    projectRoot: result.projectRoot,
    restoreDocumentFromRecovery,
    signal,
  });
  return isRequestCurrent(requestId);
}
