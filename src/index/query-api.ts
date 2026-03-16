/**
 * Query interface for the semantic document index.
 *
 * Provides types for querying indexed blocks, equations, and references
 * across all parsed markdown files.
 */

/** A query against the document index. All fields are optional filters. */
export interface IndexQuery {
  /** Block type filter: "theorem", "definition", "equation", etc. */
  readonly type?: string;
  /** Specific label to look up (e.g., "thm-1", "eq:foo"). */
  readonly label?: string;
  /** Full-text search within block content. */
  readonly content?: string;
  /** Restrict results to a specific file path. */
  readonly file?: string;
}

/** A single entry in the document index. */
export interface IndexEntry {
  /** Block type: "theorem", "definition", "equation", "heading", etc. */
  readonly type: string;
  /** Label (id) if present, e.g., "thm-1" or "eq:foo". */
  readonly label?: string;
  /** Assigned number within its counter group, if applicable. */
  readonly number?: number;
  /** Title text if present (from fenced div title). */
  readonly title?: string;
  /** Source file path. */
  readonly file: string;
  /** Character position in the source file. */
  readonly position: { readonly from: number; readonly to: number };
  /** Text content of the block (for search). */
  readonly content: string;
}

/** A cross-file reference found in the index. */
export interface IndexReference {
  /** The label being referenced (e.g., "thm-1"). */
  readonly label: string;
  /** The file containing the reference. */
  readonly sourceFile: string;
  /** Position of the reference in the source file. */
  readonly position: { readonly from: number; readonly to: number };
}

/** Per-file index data. */
export interface FileIndex {
  /** File path. */
  readonly file: string;
  /** All indexed entries in this file. */
  readonly entries: readonly IndexEntry[];
  /** All references found in this file. */
  readonly references: readonly IndexReference[];
}

/** Complete index across all files. */
export interface DocumentIndex {
  readonly files: ReadonlyMap<string, FileIndex>;
}

/** Result of resolving a cross-file reference. */
export interface ResolvedReference {
  /** The reference itself. */
  readonly reference: IndexReference;
  /** The target entry, if found. */
  readonly target: IndexEntry | undefined;
}

/**
 * Query the document index, returning all entries matching the given filters.
 * Filters are AND-combined: an entry must match all specified fields.
 */
export function queryIndex(
  index: DocumentIndex,
  query: IndexQuery,
): readonly IndexEntry[] {
  const results: IndexEntry[] = [];

  for (const [, fileIndex] of index.files) {
    if (query.file !== undefined && fileIndex.file !== query.file) continue;

    for (const entry of fileIndex.entries) {
      if (query.type !== undefined && entry.type !== query.type) continue;
      if (query.label !== undefined && entry.label !== query.label) continue;
      if (
        query.content !== undefined &&
        !entry.content.toLowerCase().includes(query.content.toLowerCase())
      ) {
        continue;
      }
      results.push(entry);
    }
  }

  return results;
}

/**
 * Resolve a label to its target entry across all files.
 * Returns the first matching entry, or undefined if not found.
 */
export function resolveLabel(
  index: DocumentIndex,
  label: string,
): IndexEntry | undefined {
  for (const [, fileIndex] of index.files) {
    for (const entry of fileIndex.entries) {
      if (entry.label === label) return entry;
    }
  }
  return undefined;
}

/**
 * Find all references to a given label across all files.
 */
export function findReferences(
  index: DocumentIndex,
  label: string,
): readonly ResolvedReference[] {
  const target = resolveLabel(index, label);
  const results: ResolvedReference[] = [];

  for (const [, fileIndex] of index.files) {
    for (const ref of fileIndex.references) {
      if (ref.label === label) {
        results.push({ reference: ref, target });
      }
    }
  }

  return results;
}
