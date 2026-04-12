/**
 * Plain-data shapes shared across the app shell, index helpers, and lib-layer
 * modules. Runtime-facing interfaces (e.g. `FileSystem`) live next to their
 * concrete implementations, not here.
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

/**
 * Plain-data block counter entry for cross-reference resolution.
 *
 * Shared plain-data representation for numbering/cross-reference formatting.
 */
export interface BlockCounterEntry {
  /** The plugin class name (e.g. "theorem"). */
  readonly type: string;
  /** Display title for the block type (e.g. "Theorem"). */
  readonly title: string;
  /** The assigned number. */
  readonly number: number;
}
