import {
  base64ToUint8Array,
  basename,
  dirname,
  uint8ArrayToBase64,
} from "./lib/utils";
import { getDemoFiles } from "./demo-files";
import { defaultDemoFiles } from "./default-demo-files";
import { sortFileEntries, sortFileTree } from "../lib/file-tree-model";
import { normalizeMarkdownReferencePath } from "../lib/markdown-reference-paths";
import { fnv1aHash } from "./save-pipeline";

// Re-export canonical types from src/lib/types.ts so that existing
// `from "./file-manager"` / `from "../file-manager"` imports keep working.
export type { ConditionalWriteResult, FileEntry, FileSystem } from "../lib/types";

// Local import for use in this file's implementation.
import type { ConditionalWriteResult, FileEntry, FileSystem } from "../lib/types";

export type MemoryFileSystemEntry =
  | { path: string; kind: "text"; content: string }
  | { path: string; kind: "binary"; base64: string };

function buildDemoAssetUrl(path: string): string | null {
  const normalized = normalizeMarkdownReferencePath(path);
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
  private readonly files: Map<string, string>;
  private readonly binaryPaths: Set<string>;
  /** Tracks explicitly created directories (not just inferred from file paths). */
  private readonly dirs: Set<string>;
  private immediateChildrenCache: Map<string, readonly FileEntry[]> | null = null;

  constructor(initialFiles?: Record<string, string>) {
    this.files = new Map(Object.entries(initialFiles ?? {}));
    this.binaryPaths = new Set();
    this.dirs = new Set();
  }

  replaceAll(entries: readonly MemoryFileSystemEntry[]): void {
    this.files.clear();
    this.binaryPaths.clear();
    this.dirs.clear();

    for (const entry of entries) {
      const parts = entry.path.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        this.dirs.add(parts.slice(0, i).join("/"));
      }
      this.files.set(entry.path, entry.kind === "text" ? entry.content : entry.base64);
      if (entry.kind === "binary") {
        this.binaryPaths.add(entry.path);
      }
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
      cache.set(path, sortFileEntries([...entries.values()]));
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

    return sortFileTree(root);
  }

  async listChildren(path: string): Promise<FileEntry[]> {
    return (this.getImmediateChildrenCache().get(path) ?? []).map((entry) => ({ ...entry }));
  }

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new Error(`File not found: ${path}`);
    }
    this.files.set(path, content);
    this.binaryPaths.delete(path);
  }

  async writeFileIfUnchanged(
    path: string,
    content: string,
    expectedHash: string,
  ): Promise<ConditionalWriteResult> {
    const currentContent = this.files.get(path);
    if (currentContent === undefined) {
      return { written: false, missing: true };
    }
    if (fnv1aHash(currentContent) !== expectedHash) {
      return { written: false, currentContent };
    }
    this.files.set(path, content);
    this.binaryPaths.delete(path);
    return { written: true, currentContent: content };
  }

  async createFile(path: string, content?: string): Promise<void> {
    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.files.set(path, content ?? "");
    this.binaryPaths.delete(path);
    this.invalidateImmediateChildrenCache();
  }

  async exists(path: string): Promise<boolean> {
    if (this.files.has(path)) return true;
    if (this.dirs.has(path)) return true;
    // Check for implicit directories (created by file paths)
    const prefix = path + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
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
    if (this.binaryPaths.delete(oldPath)) {
      this.binaryPaths.add(newPath);
    }
    this.invalidateImmediateChildrenCache();
  }

  async createDirectory(path: string): Promise<void> {
    if (this.dirs.has(path)) {
      throw new Error(`Directory already exists: ${path}`);
    }
    // A "directory" is also implicitly present if any file lives inside it
    const prefix = path + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
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
    this.files.set(path, uint8ArrayToBase64(data));
    this.binaryPaths.add(path);
    this.invalidateImmediateChildrenCache();
  }

  async readFileBinary(path: string): Promise<Uint8Array> {
    const content = this.files.get(path);
    if (content !== undefined) {
      if (this.binaryPaths.has(path)) {
        return base64ToUint8Array(content);
      }
      return new TextEncoder().encode(content);
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
    } catch (_error) {
      // fetch failed — fall through to error
    }
    throw new Error(`File not found: ${path}`);
  }

  async deleteFile(path: string): Promise<void> {
    // Check if it's a file first
    if (this.files.has(path)) {
      this.files.delete(path);
      this.binaryPaths.delete(path);
      this.invalidateImmediateChildrenCache();
      return;
    }

    // Check if it's a directory (explicit or implicit via children)
    const prefix = path + "/";
    let found = this.dirs.has(path);
    if (!found) {
      for (const key of this.files.keys()) {
        if (key.startsWith(prefix)) {
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
      if (dir.startsWith(prefix)) this.dirs.delete(dir);
    }
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
    this.invalidateImmediateChildrenCache();
  }
}

/** Create a demo filesystem with sample markdown files. */
export function createDemoFileSystem(): MemoryFileSystem {
  return new MemoryFileSystem(defaultDemoFiles);
}

/** Create a demo filesystem with the imported demo project. */
export async function createBlogDemoFileSystem(): Promise<MemoryFileSystem> {
  const demoFiles = await getDemoFiles();
  const hasLocalBlogProject = Object.keys(demoFiles).some((path) => path !== "FORMAT.md");

  if (hasLocalBlogProject) {
    return new MemoryFileSystem(demoFiles);
  }

  return new MemoryFileSystem({
    ...defaultDemoFiles,
    ...(demoFiles["FORMAT.md"] ? { "FORMAT.md": demoFiles["FORMAT.md"] } : {}),
    // Keep browser-only tooling that opens index.md working when the local
    // blog fixture is absent and we fall back to the built-in sample project.
    "index.md": defaultDemoFiles["main.md"],
  });
}
