import {
  base64ToUint8Array,
  basename,
  dirname,
  uint8ArrayToBase64,
} from "./lib/utils";
import {
  isDescendantProjectPath,
  normalizeProjectPath,
} from "../lib/project-paths";
import type { FileEntry } from "../lib/types";
import type { FileSystem } from "./file-system";

export type MemoryFileSystemEntry =
  | { path: string; kind: "text"; content: string }
  | { path: string; kind: "binary"; base64: string };

type StoredMemoryFile =
  | { kind: "text"; content: string }
  | { kind: "binary"; base64: string };

function buildDemoAssetUrl(path: string): string | null {
  const normalized = normalizeProjectPath(path);
  if (
    !normalized ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }

  return `/demo/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/** In-memory filesystem for demo/testing purposes. */
export class MemoryFileSystem implements FileSystem {
  private readonly files: Map<string, StoredMemoryFile>;
  /** Tracks explicitly created directories (not just inferred from file paths). */
  private readonly dirs: Set<string>;
  private immediateChildrenCache: Map<string, readonly FileEntry[]> | null = null;

  constructor(initialFiles?: Record<string, string>) {
    this.files = new Map(
      Object.entries(initialFiles ?? {}).map(([path, content]) => [
        path,
        { kind: "text", content },
      ] satisfies [string, StoredMemoryFile]),
    );
    this.dirs = new Set();
  }

  replaceAll(entries: readonly MemoryFileSystemEntry[]): void {
    this.files.clear();
    this.dirs.clear();

    for (const entry of entries) {
      const parts = entry.path.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        this.dirs.add(parts.slice(0, i).join("/"));
      }
      this.files.set(entry.path, entry.kind === "text"
        ? { kind: "text", content: entry.content }
        : { kind: "binary", base64: entry.base64 });
    }

    this.invalidateImmediateChildrenCache();
  }

  private invalidateImmediateChildrenCache(): void {
    this.immediateChildrenCache = null;
  }

  private getImmediateChildrenCache(): Map<string, readonly FileEntry[]> {
    if (this.immediateChildrenCache) {
      return this.immediateChildrenCache;
    }

    const entriesByParent = new Map<string, Map<string, FileEntry>>();

    const ensureParent = (path: string): Map<string, FileEntry> => {
      let entries = entriesByParent.get(path);
      if (!entries) {
        entries = new Map();
        entriesByParent.set(path, entries);
      }
      return entries;
    };

    const addEntry = (parentPath: string, entry: FileEntry) => {
      ensureParent(parentPath).set(entry.path, entry);
    };

    const addDirectoryChain = (path: string) => {
      ensureParent(path);
      let current = path;
      while (current !== "") {
        const parentPath = dirname(current);
        addEntry(parentPath, {
          name: basename(current),
          path: current,
          isDirectory: true,
        });
        ensureParent(parentPath);
        current = parentPath;
      }
    };

    ensureParent("");

    for (const dirPath of this.dirs) {
      addDirectoryChain(dirPath);
    }

    for (const filePath of this.files.keys()) {
      const parentPath = dirname(filePath);
      addDirectoryChain(parentPath);
      addEntry(parentPath, {
        name: basename(filePath),
        path: filePath,
        isDirectory: false,
      });
    }

    const cache = new Map<string, readonly FileEntry[]>();
    for (const [path, entries] of entriesByParent) {
      cache.set(path, [...entries.values()].sort(compareFileEntries));
    }

    this.immediateChildrenCache = cache;
    return cache;
  }

  async listTree(): Promise<FileEntry> {
    const root: FileEntry = {
      name: "project",
      path: "",
      isDirectory: true,
      children: [],
    };

    /** Ensure all ancestor directory nodes exist and return the leaf's parent. */
    const ensureDirNode = (parts: string[]): FileEntry => {
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const partialPath = parts.slice(0, i + 1).join("/");
        if (!current.children) current.children = [];
        let node = current.children.find((c) => c.name === part);
        if (!node) {
          node = { name: part, path: partialPath, isDirectory: true, children: [] };
          current.children.push(node);
        }
        current = node;
      }
      return current;
    };

    // Materialise explicitly created empty directories first
    for (const dirPath of [...this.dirs].sort()) {
      const parts = dirPath.split("/");
      const parentParts = parts.slice(0, -1);
      const dirName = parts[parts.length - 1];
      const parent = ensureDirNode(parentParts);
      if (!parent.children) parent.children = [];
      if (!parent.children.find((c) => c.name === dirName)) {
        parent.children.push({ name: dirName, path: dirPath, isDirectory: true, children: [] });
      }
    }

    // Add files, creating ancestor directory nodes as needed
    for (const filePath of [...this.files.keys()].sort()) {
      const parts = filePath.split("/");
      const fileName = parts[parts.length - 1];
      const parentParts = parts.slice(0, -1);
      const parent = ensureDirNode(parentParts);
      if (!parent.children) parent.children = [];
      if (!parent.children.find((c) => c.name === fileName)) {
        parent.children.push({ name: fileName, path: filePath, isDirectory: false });
      }
    }

    sortTree(root);
    return root;
  }

  async listChildren(path: string): Promise<FileEntry[]> {
    return (this.getImmediateChildrenCache().get(path) ?? []).map((entry) => ({ ...entry }));
  }

  async readFile(path: string): Promise<string> {
    const entry = this.files.get(path);
    if (entry === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return entry.kind === "text" ? entry.content : entry.base64;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    this.files.set(path, { kind: "text", content });
  }

  async createFile(path: string, content?: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.files.set(path, { kind: "text", content: content ?? "" });
    this.invalidateImmediateChildrenCache();
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    if (this.dirs.has(path)) return true;
    // Check for implicit directories (created by file paths)
    for (const key of this.files.keys()) {
      if (isDescendantProjectPath(key, path)) return true;
    }
    return false;
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content === undefined) {
      throw new Error(`File not found: ${oldPath}`);
    }
    if (this.files.has(newPath)) {
      throw new Error(`File already exists: ${newPath}`);
    }
    this.files.delete(oldPath);
    this.files.set(newPath, content);
    this.invalidateImmediateChildrenCache();
  }

  async createDirectory(path: string): Promise<void> {
    if (this.dirs.has(path)) {
      throw new Error(`Directory already exists: ${path}`);
    }
    // A "directory" is also implicitly present if any file lives inside it
    for (const key of this.files.keys()) {
      if (isDescendantProjectPath(key, path)) {
        throw new Error(`Directory already exists: ${path}`);
      }
    }
    this.dirs.add(path);
    this.invalidateImmediateChildrenCache();
  }

  async writeFileBinary(path: string, data: Uint8Array): Promise<void> {
    // In memory mode, store binary data as a base64 string.
    // Ensure parent directories exist.
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!this.dirs.has(dirPath)) {
        this.dirs.add(dirPath);
      }
    }
    this.files.set(path, { kind: "binary", base64: uint8ArrayToBase64(data) });
    this.invalidateImmediateChildrenCache();
  }

  async readFileBinary(path: string): Promise<Uint8Array> {
    const entry = this.files.get(path);
    if (entry !== undefined) {
      const content = entry.kind === "binary" ? entry.base64 : entry.content;
      try {
        return base64ToUint8Array(content);
      } catch {
        return new TextEncoder().encode(content);
      }
    }
    // Fallback: try fetching as a static asset (e.g., PDF files served by Vite
    // from the demo/ directory that weren't loaded into the in-memory filesystem).
    const demoAssetUrl = buildDemoAssetUrl(path);
    if (!demoAssetUrl) {
      throw new Error(`File not found: ${path}`);
    }
    try {
      const resp = await fetch(demoAssetUrl);
      if (resp.ok) {
        return new Uint8Array(await resp.arrayBuffer());
      }
    } catch {
      // fetch failed — fall through to error
    }
    throw new Error(`File not found: ${path}`);
  }

  async deleteFile(path: string): Promise<void> {
    // Check if it's a file first
    if (this.files.has(path)) {
      this.files.delete(path);
      this.invalidateImmediateChildrenCache();
      return;
    }

    // Check if it's a directory (explicit or implicit via children)
    let found = this.dirs.has(path);
    if (!found) {
      for (const key of this.files.keys()) {
        if (isDescendantProjectPath(key, path)) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      throw new Error(`File not found: ${path}`);
    }

    // Delete the directory and all its children
    this.dirs.delete(path);
    for (const dir of [...this.dirs]) {
      if (isDescendantProjectPath(dir, path)) this.dirs.delete(dir);
    }
    for (const key of [...this.files.keys()]) {
      if (isDescendantProjectPath(key, path)) this.files.delete(key);
    }
    this.invalidateImmediateChildrenCache();
  }
}

function compareFileEntries(a: FileEntry, b: FileEntry): number {
  if (a.isDirectory !== b.isDirectory) {
    return a.isDirectory ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/** Sort a file tree: directories first, then alphabetical. */
function sortTree(entry: FileEntry): void {
  if (!entry.children) return;
  entry.children.sort(compareFileEntries);
  for (const child of entry.children) {
    sortTree(child);
  }
}

