import { findDefaultDocumentPath } from "./default-document-path";
import type { FileEntry } from "./file-manager";
import type { ProjectOpenResult } from "./project-open-result";

export interface OpenProjectInCurrentWindowOptions {
  projectRoot: string;
  initialPath?: string;
  currentProjectRoot: string | null;
  nextRequestId: () => number;
  isRequestCurrent: (requestId: number) => boolean;
  cancelPendingOpenFile: () => void;
  closeCurrentFile: () => Promise<boolean>;
  openProjectRoot: (path: string) => Promise<ProjectOpenResult | null>;
  canonicalizeProjectRoot?: (path: string) => Promise<string>;
  openFile: (path: string) => Promise<void>;
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
  openProjectRoot,
  canonicalizeProjectRoot,
  openFile,
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

  const closed = await closeCurrentFile();
  if (!closed || !isRequestCurrent(requestId)) {
    return false;
  }

  const result = await openProjectRoot(projectRoot);
  if (!result || !isRequestCurrent(requestId)) {
    return false;
  }

  const targetPath = initialPath ?? await findDefaultDocumentPath(result.tree, listChildren, signal);
  if (!targetPath) {
    return isRequestCurrent(requestId);
  }
  if (!isRequestCurrent(requestId)) {
    return false;
  }

  await openFile(targetPath);
  return isRequestCurrent(requestId);
}
