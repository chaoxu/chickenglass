import type { FileEntry } from "./file-manager";

/**
 * Find the default document to open for a project.
 *
 * Preference order: main.md > index.md > any .md at root > depth-first search.
 *
 * When `listChildren` is provided, unloaded directories (`children === undefined`)
 * are lazily populated on demand (Tauri mode).  Without it, unloaded directories
 * are skipped (browser/eager-tree mode).
 */
export async function findDefaultDocumentPath(
  fileTree: FileEntry,
  listChildren?: (path: string) => Promise<FileEntry[]>,
): Promise<string | null> {
  const rootFiles = (fileTree.children ?? []).filter((entry) => !entry.isDirectory);
  const preferred = rootFiles.find((entry) => entry.path === "main.md")
    ?? rootFiles.find((entry) => entry.path === "index.md")
    ?? rootFiles.find((entry) => entry.path.endsWith(".md"));
  if (preferred) return preferred.path;

  const findFirst = async (entry: FileEntry): Promise<string | null> => {
    if (!entry.isDirectory) return entry.path;
    const children = listChildren
      ? (entry.children ?? await listChildren(entry.path))
      : (entry.children ?? []);
    for (const child of children) {
      const found = await findFirst(child);
      if (found) return found;
    }
    return null;
  };

  return findFirst(fileTree);
}
