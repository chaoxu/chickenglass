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
