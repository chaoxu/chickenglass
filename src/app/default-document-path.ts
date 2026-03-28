import type { FileEntry } from "./file-manager";

export function findDefaultDocumentPath(fileTree: FileEntry): string | null {
  const rootFiles = (fileTree.children ?? []).filter((entry) => !entry.isDirectory);
  const preferred = rootFiles.find((entry) => entry.path === "main.md")
    ?? rootFiles.find((entry) => entry.path === "index.md")
    ?? rootFiles.find((entry) => entry.path.endsWith(".md"));

  const findFirst = (entry: FileEntry): string | null => {
    if (!entry.isDirectory) return entry.path;
    for (const child of entry.children ?? []) {
      const found = findFirst(child);
      if (found) return found;
    }
    return null;
  };

  return preferred?.path ?? findFirst(fileTree);
}

/**
 * Async variant that lazily loads directory children via `listChildren`
 * when they haven't been loaded yet (`children === undefined`).
 *
 * Used in Tauri mode where the file tree starts shallow and subdirectories
 * are loaded on demand.
 */
export async function findDefaultDocumentPathLazy(
  fileTree: FileEntry,
  listChildren: (path: string) => Promise<FileEntry[]>,
): Promise<string | null> {
  const rootFiles = (fileTree.children ?? []).filter((entry) => !entry.isDirectory);
  const preferred = rootFiles.find((entry) => entry.path === "main.md")
    ?? rootFiles.find((entry) => entry.path === "index.md")
    ?? rootFiles.find((entry) => entry.path.endsWith(".md"));
  if (preferred) return preferred.path;

  const findFirst = async (entry: FileEntry): Promise<string | null> => {
    if (!entry.isDirectory) return entry.path;
    const children = entry.children ?? await listChildren(entry.path);
    for (const child of children) {
      const found = await findFirst(child);
      if (found) return found;
    }
    return null;
  };

  return findFirst(fileTree);
}
