import type { FileEntry } from "./file-manager";

type LazyChildrenResult =
  | { status: "fulfilled"; children: FileEntry[] }
  | { status: "rejected"; reason: unknown };

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
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;

  const rootFiles = (fileTree.children ?? []).filter((entry) => !entry.isDirectory);
  const preferred = rootFiles.find((entry) => entry.path === "main.md")
    ?? rootFiles.find((entry) => entry.path === "index.md")
    ?? rootFiles.find((entry) => entry.path.endsWith(".md"));
  if (preferred) return preferred.path;

  const preloadUnloadedDirectoryChildren = async (
    children: FileEntry[],
  ): Promise<Map<string, Promise<LazyChildrenResult>>> => {
    if (!listChildren || signal) return new Map();
    const unloadedDirectories = children.filter((child) =>
      child.isDirectory && child.children === undefined
    );
    const loaded = unloadedDirectories.map((child) => [
      child.path,
      listChildren(child.path).then<LazyChildrenResult, LazyChildrenResult>(
        (childEntries) => ({ status: "fulfilled", children: childEntries }),
        (reason: unknown) => ({ status: "rejected", reason }),
      ),
    ] as const);
    return new Map(loaded);
  };

  const findFirst = async (
    entry: FileEntry,
    preloadedChildren?: FileEntry[],
  ): Promise<string | null> => {
    if (signal?.aborted) return null;
    if (!entry.isDirectory) return entry.path;
    const children = preloadedChildren
      ?? (listChildren ? (entry.children ?? await listChildren(entry.path)) : (entry.children ?? []));
    if (signal?.aborted) return null;
    const childPreloads = await preloadUnloadedDirectoryChildren(children);
    if (signal?.aborted) return null;
    for (const child of children) {
      const preloaded = await childPreloads.get(child.path);
      if (preloaded?.status === "rejected") {
        throw preloaded.reason;
      }
      const found = await findFirst(child, preloaded?.children);
      if (found) return found;
    }
    return null;
  };

  return findFirst(fileTree);
}
