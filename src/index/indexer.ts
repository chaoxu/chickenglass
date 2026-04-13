/**
 * Main-thread document indexer.
 *
 * Maintains an in-memory index of parsed markdown files and provides
 * synchronous query methods. Extraction runs directly on the main thread
 * from the canonical markdown text — no web worker involved.
 *
 * Design decision (T21): The web worker was removed because the overhead
 * of a separate bundle, structured-clone message serialization for every
 * update/query, and forced async indirection for trivial Map lookups far
 * exceeds the cost of main-thread markdown extraction. For typical math
 * documents (5–50 KB), extraction takes sub-millisecond to a few milliseconds,
 * well within a single frame budget. Queries (resolve, find, filter) are pure
 * Map/array lookups that complete in microseconds.
 */

import type {
  FileIndex,
  IndexEntry,
  IndexQuery,
  LabelResolution,
  ResolvedReference,
  SourceTextQuery,
} from "./query-api";
import { findReferences, getAllLabels, queryIndex, querySourceText, resolveLabel } from "./query-api";
import { extractFileIndex, updateFileInIndex, removeFileFromIndex } from "./extract";

/**
 * Document indexer that runs extraction and queries on the main thread.
 *
 * Usage:
 * ```ts
 * const indexer = new BackgroundIndexer();
 * indexer.updateFile("chapter1.md", content);
 * const theorems = indexer.query({ type: "theorem" });
 * ```
 */
export class BackgroundIndexer {
  private files = new Map<string, FileIndex>();

  private getDocumentIndex(): { files: ReadonlyMap<string, FileIndex> } {
    return { files: this.files };
  }

  /**
   * Update or add a single file without disturbing other indexed files.
   * Returns the number of entries found in the file.
   */
  updateFile(file: string, content: string): number {
    this.files = updateFileInIndex(this.files, file, content);
    return this.files.get(file)?.entries.length ?? 0;
  }

  /** Remove a file from the index. */
  removeFile(file: string): void {
    this.files = removeFileFromIndex(this.files, file);
  }

  /** Query the index with the given filters. */
  query(query: IndexQuery): readonly IndexEntry[] {
    return queryIndex(this.getDocumentIndex(), query);
  }

  /** Query raw source text across indexed files. */
  querySourceText(query: SourceTextQuery): readonly IndexEntry[] {
    return querySourceText(this.getDocumentIndex(), query);
  }

  /** Resolve a label to its index entry. */
  resolveLabel(label: string): LabelResolution {
    return resolveLabel(this.getDocumentIndex(), label);
  }

  /** Find all references to a label across all files. */
  findReferences(label: string): readonly ResolvedReference[] {
    return findReferences(this.getDocumentIndex(), label);
  }

  /** Get the full index for a specific file. */
  getFileIndex(file: string): FileIndex | undefined {
    return this.files.get(file);
  }

  /** Get all labels from all indexed files. */
  getAllLabels(): readonly string[] {
    return getAllLabels(this.getDocumentIndex());
  }

  /**
   * Rebuild the index from an exact file snapshot. Files omitted from this
   * batch are removed; use `updateFile()` / `removeFile()` for incremental sync.
   * Returns the total entry count in the rebuilt index.
   */
  bulkUpdate(
    files: ReadonlyArray<{ file: string; content: string }>,
  ): number {
    const nextFiles = new Map<string, FileIndex>();
    let totalEntries = 0;
    for (const { file, content } of files) {
      const fileIndex = extractFileIndex(content, file);
      nextFiles.set(file, fileIndex);
      totalEntries += fileIndex.entries.length;
    }
    this.files = nextFiles;
    return totalEntries;
  }
}
