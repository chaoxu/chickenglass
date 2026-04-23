/**
 * Shared type definitions for the filesystem abstraction.
 *
 * These interfaces are used across plugins/, editor/, render/, and app/.
 * Keeping them here avoids app/ → plugins/ or render/ → app/ boundary
 * violations.
 */

import { Facet } from "@codemirror/state";

/**
 * CM6 Facet that provides a FileSystem instance to render plugins.
 *
 * The app layer provides `fileSystemFacet.of(fs)` when creating the editor.
 * Render plugins (e.g., image-render for PDF preview) read it to perform
 * binary file I/O without importing from the app layer.
 *
 * Pattern follows projectConfigFacet: at most one provider, last wins.
 */
export const fileSystemFacet = Facet.define<FileSystem | null, FileSystem | null>({
  combine(values) {
    // There should be at most one provider. Take the last non-null one.
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null) return values[i];
    }
    return null;
  },
});

/**
 * CM6 Facet that provides the current document's project-relative path.
 *
 * Render plugins (e.g., image-render for PDF preview) use it to resolve
 * relative media paths against the document's directory, so that
 * `![](diagram.pdf)` in `posts/math.md` resolves to `posts/diagram.pdf`.
 *
 * Pattern follows fileSystemFacet: at most one provider, last wins.
 * Default is "" (project root), which means relative paths resolve from root.
 */
export const documentPathFacet = Facet.define<string, string>({
  combine(values) {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i]) return values[i];
    }
    return "";
  },
});

/** File entry representing a single file or directory in the tree. */
export interface FileEntry {
  /** File name (without path). */
  name: string;
  /** Full path from the project root. */
  path: string;
  /** Whether this entry is a directory. */
  isDirectory: boolean;
  /** Child entries (only populated for directories). */
  children?: FileEntry[];
}

export interface ConditionalWriteResult {
  written: boolean;
  missing?: boolean;
  currentContent?: string;
}

/**
 * Plain-data block counter entry for cross-reference resolution.
 *
 * Mirrors `NumberedBlock` from the CM6 block-counter state field but without
 * position data — only the fields needed for label formatting. Lives here so
 * that preview and editor render layers can share the type without crossing
 * app/editor boundaries.
 */
export interface BlockCounterEntry {
  /** The plugin class name (e.g. "theorem"). */
  readonly type: string;
  /** Display title for the block type (e.g. "Theorem"). */
  readonly title: string;
  /** The assigned number. */
  readonly number: number;
}

/** Abstract filesystem interface for different backends. */
export interface FileSystem {
  /** List all files/directories as a tree starting from root. */
  listTree(): Promise<FileEntry>;
  /**
   * List the direct children of a single directory (non-recursive).
   *
   * Directory entries are returned with `children` undefined (not yet loaded).
   * When absent, callers should fall back to `listTree()`.
   */
  listChildren?(path: string): Promise<FileEntry[]>;
  /** Read the content of a file at the given path. */
  readFile(path: string): Promise<string>;
  /** Write content to a file at the given path. */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Write text only when the current disk content still matches the expected
   * baseline hash. Implementations that cannot provide a conditional write may
   * omit this method; callers must then use a less strict fallback.
   */
  writeFileIfUnchanged?(
    path: string,
    content: string,
    expectedHash: string,
  ): Promise<ConditionalWriteResult>;
  /** Create a new file with optional initial content. */
  createFile(path: string, content?: string): Promise<void>;
  /** Check whether a file exists at the given path. */
  exists(path: string): Promise<boolean>;
  /** Rename a file from oldPath to newPath. */
  renameFile(oldPath: string, newPath: string): Promise<void>;
  /** Create a new directory at the given path. */
  createDirectory(path: string): Promise<void>;
  /** Delete a file at the given path. */
  deleteFile(path: string): Promise<void>;
  /**
   * Write binary data to a file at the given path.
   * Creates parent directories if needed. Overwrites if the file exists.
   *
   * @param path    Relative path within the project.
   * @param data    Binary data as a Uint8Array.
   */
  writeFileBinary(path: string, data: Uint8Array): Promise<void>;
  /**
   * Read binary data from a file at the given path.
   *
   * @param path    Relative path within the project.
   * @returns       The file contents as a Uint8Array.
   */
  readFileBinary(path: string): Promise<Uint8Array>;
}
