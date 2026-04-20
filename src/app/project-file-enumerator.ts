import type { FileEntry, FileSystem } from "./file-system";

export interface ProjectFileEnumerationOptions {
  readonly fs?: FileSystem;
  readonly root?: FileEntry;
  readonly listChildren?: (path: string) => Promise<FileEntry[]>;
  readonly signal?: AbortSignal;
}

export interface ProjectTextFile {
  readonly file: string;
  readonly content: string;
}

export interface ReadProjectTextFilesOptions {
  readonly contentOverrides?: ReadonlyMap<string, string>;
  readonly signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Project file enumeration aborted.", "AbortError");
  }
}

function isMarkdownFile(entry: FileEntry): boolean {
  return !entry.isDirectory && entry.path.endsWith(".md");
}

export async function listProjectFiles({
  fs,
  root,
  listChildren,
  signal,
}: ProjectFileEnumerationOptions): Promise<FileEntry[]> {
  throwIfAborted(signal);
  const tree = root ?? await fs?.listTree();
  if (!tree) {
    throw new Error("Provide either a project file tree or filesystem.");
  }
  const loadChildren = listChildren ?? fs?.listChildren?.bind(fs);
  const files: FileEntry[] = [];

  const visit = async (entry: FileEntry): Promise<void> => {
    throwIfAborted(signal);
    if (!entry.isDirectory) {
      files.push(entry);
      return;
    }

    const children = entry.children ?? (loadChildren ? await loadChildren(entry.path) : []);
    throwIfAborted(signal);
    for (const child of children) {
      await visit(child);
    }
  };

  await visit(tree);
  return files;
}

export async function listAllMarkdownFiles(
  options: ProjectFileEnumerationOptions,
): Promise<string[]> {
  const files = await listProjectFiles(options);
  return files.filter(isMarkdownFile).map((entry) => entry.path);
}

export function collectMarkdownPathsFromTree(entry: FileEntry): string[] {
  const results: string[] = [];
  const visit = (node: FileEntry) => {
    if (node.isDirectory) {
      for (const child of node.children ?? []) {
        visit(child);
      }
      return;
    }
    if (node.path.endsWith(".md")) {
      results.push(node.path);
    }
  };
  visit(entry);
  return results;
}

export async function readProjectTextFiles(
  fs: FileSystem,
  paths: readonly string[],
  { contentOverrides, signal }: ReadProjectTextFilesOptions = {},
): Promise<ProjectTextFile[]> {
  const files: ProjectTextFile[] = [];
  for (const path of paths) {
    throwIfAborted(signal);
    files.push({
      file: path,
      content: contentOverrides?.get(path) ?? await fs.readFile(path),
    });
  }
  return files;
}
