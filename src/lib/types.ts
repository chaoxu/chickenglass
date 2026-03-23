/**
 * Shared type definitions for the filesystem abstraction.
 *
 * These interfaces are used across plugins/, editor/, render/, and app/.
 * Keeping them here avoids app/ → plugins/ or render/ → app/ boundary
 * violations.
 */

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

/** Abstract filesystem interface for different backends. */
export interface FileSystem {
  /** List all files/directories as a tree starting from root. */
  listTree(): Promise<FileEntry>;
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
}
