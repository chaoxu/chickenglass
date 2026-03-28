import { findDefaultDocumentPath, findDefaultDocumentPathLazy } from "./default-document-path";
import type { FileEntry } from "./file-manager";

export interface OpenProjectInCurrentWindowOptions {
  projectRoot: string;
  initialPath?: string;
  currentProjectRoot: string | null;
  nextRequestId: () => number;
  isRequestCurrent: (requestId: number) => boolean;
  cancelPendingOpenFile: () => void;
  closeCurrentFile: () => Promise<boolean>;
  openProjectRoot: (path: string) => Promise<FileEntry | null>;
  openFile: (path: string) => Promise<void>;
  /** When provided, default-doc search loads subdirectories lazily. */
  listChildren?: (path: string) => Promise<FileEntry[]>;
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
  openFile,
  listChildren,
}: OpenProjectInCurrentWindowOptions): Promise<boolean> {
  const requestId = nextRequestId();

  // A newer project-switch request must be able to invalidate any older
  // in-flight openFile(), even if the newer project does not open a document.
  cancelPendingOpenFile();

  const replacingProject = currentProjectRoot !== projectRoot;
  if (replacingProject) {
    const closed = await closeCurrentFile();
    if (!closed || !isRequestCurrent(requestId)) {
      return false;
    }
  }

  const tree = await openProjectRoot(projectRoot);
  if (!tree || !isRequestCurrent(requestId)) {
    return false;
  }

  const targetPath = initialPath ?? (
    listChildren
      ? await findDefaultDocumentPathLazy(tree, listChildren)
      : findDefaultDocumentPath(tree)
  );
  if (!targetPath) {
    return isRequestCurrent(requestId);
  }
  if (!isRequestCurrent(requestId)) {
    return false;
  }

  await openFile(targetPath);
  return isRequestCurrent(requestId);
}
