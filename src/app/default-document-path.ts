import type { FileEntry } from "./file-manager";
import { listAllMarkdownFiles } from "./project-file-enumerator";

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

  try {
    const [first] = await listAllMarkdownFiles({
      root: fileTree,
      listChildren,
      signal,
    });
    return first ?? null;
  } catch (error: unknown) {
    if (signal?.aborted && error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}
