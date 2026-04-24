import type { FileEntry } from "./types";

export const FILE_TREE_ROOT_ITEM_ID = "__cf-file-tree-root__";

export interface FileTreeIndex {
  readonly entriesById: Map<string, FileEntry>;
  readonly childrenById: Map<string, string[]>;
}

export interface BuildFileTreeIndexOptions {
  readonly rootItemId?: string;
}

export function compareFileEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export function sortFileEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort(compareFileEntries);
}

export function sortFileTree(entry: FileEntry): FileEntry {
  if (!entry.children) {
    return entry;
  }
  return {
    ...entry,
    children: sortFileEntries(entry.children).map(sortFileTree),
  };
}

export function getFileParentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.substring(0, i);
}

export function flattenVisibleFileEntries(
  entries: readonly FileEntry[],
  openPaths: ReadonlySet<string>,
): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.isDirectory && openPaths.has(entry.path) && entry.children) {
      result.push(...flattenVisibleFileEntries(entry.children, openPaths));
    }
  }
  return result;
}

export function buildFileTreeIndex(
  root: FileEntry | null,
  options: BuildFileTreeIndexOptions = {},
): FileTreeIndex {
  const rootItemId = options.rootItemId ?? FILE_TREE_ROOT_ITEM_ID;
  const entriesById = new Map<string, FileEntry>();
  const childrenById = new Map<string, string[]>();

  const syntheticRoot: FileEntry = root ?? {
    name: "root",
    path: "",
    isDirectory: true,
    children: [],
  };

  entriesById.set(rootItemId, syntheticRoot);
  childrenById.set(
    rootItemId,
    syntheticRoot.children?.map((entry) => entry.path) ?? [],
  );

  const visit = (entry: FileEntry) => {
    entriesById.set(entry.path, entry);
    childrenById.set(
      entry.path,
      entry.isDirectory ? entry.children?.map((child) => child.path) ?? [] : [],
    );
    entry.children?.forEach(visit);
  };

  syntheticRoot.children?.forEach(visit);

  return { entriesById, childrenById };
}

export function replaceFileTreeChildren(
  tree: FileEntry,
  dirPath: string,
  newChildren: FileEntry[],
): FileEntry {
  if (tree.path === dirPath) {
    const prevChildren = tree.children;
    const merged = newChildren.map((child) => {
      // Preserve loaded descendants when refreshing a directory listing so
      // expanded folders do not collapse back to unloaded placeholders.
      if (!child.isDirectory || !prevChildren) return child;
      const prev = prevChildren.find((c) => c.path === child.path && c.isDirectory);
      if (prev?.children !== undefined) {
        return { ...child, children: prev.children };
      }
      return child;
    });
    return { ...tree, children: merged };
  }
  if (!tree.children) return tree;
  let changed = false;
  const mapped = tree.children.map((child) => {
    if (!child.isDirectory) return child;
    if (child.path !== dirPath && !dirPath.startsWith(child.path + "/")) return child;
    const replaced = replaceFileTreeChildren(child, dirPath, newChildren);
    if (replaced !== child) changed = true;
    return replaced;
  });
  return changed ? { ...tree, children: mapped } : tree;
}

export function mergeLazyFileTreeChildren(
  tree: FileEntry,
  dirPath: string,
  children: FileEntry[],
): FileEntry {
  if (tree.path === dirPath) {
    // Late lazy-load responses must not overwrite an already materialized subtree.
    if (tree.children !== undefined) return tree;
    return { ...tree, children };
  }
  if (!tree.children) return tree;
  let changed = false;
  const mapped = tree.children.map((child) => {
    if (!child.isDirectory) return child;
    if (child.path !== dirPath && !dirPath.startsWith(child.path + "/")) return child;
    const merged = mergeLazyFileTreeChildren(child, dirPath, children);
    if (merged !== child) changed = true;
    return merged;
  });
  return changed ? { ...tree, children: mapped } : tree;
}
