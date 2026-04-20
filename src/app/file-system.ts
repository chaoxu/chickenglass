import type { FileEntry } from "../lib/types";

export type { FileEntry };

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
