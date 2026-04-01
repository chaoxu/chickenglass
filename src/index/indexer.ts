/**
 * Main-thread document indexer.
 *
 * Maintains an in-memory index of all parsed markdown files and provides
 * synchronous query methods. Extraction runs directly on the main thread
 * using the Lezer parser — no web worker involved.
 *
 * Design decision (T21): The web worker was removed because the overhead
 * of worker bundle duplication (Lezer parser + extensions duplicated in a
 * separate bundle), structured-clone message serialization for every
 * update/query, and forced async indirection for trivial Map lookups far
 * exceeds the cost of main-thread Lezer parsing. For typical math documents
 * (5–50 KB), Lezer tree parsing + extraction takes sub-millisecond to a
 * few milliseconds — well within a single frame budget. Queries (resolve,
 * find, filter) are pure Map/array lookups that complete in microseconds.
 */

import type {
  FileIndex,
  IndexEntry,
  IndexQuery,
  ResolvedReference,
  SourceTextQuery,
} from "./query-api";
import { findReferences, queryIndex, querySourceText, resolveLabel } from "./query-api";
import { extractFileIndex, updateFileInIndex, removeFileFromIndex } from "./extract";

/**
 * Document indexer that runs extraction and queries on the main thread.
 *
 * All methods return Promises for API compatibility with consumers that
 * were written against the previous async worker-based interface, but
 * they resolve synchronously.
 *
 * Usage:
 * ```ts
 * const indexer = new BackgroundIndexer();
 * await indexer.updateFile("chapter1.md", content);
 * const theorems = await indexer.query({ type: "theorem" });
 * indexer.dispose();
 * ```
 */
export class BackgroundIndexer {
  private files = new Map<string, FileIndex>();
  private disposed = false;

  private getDocumentIndex(): { files: ReadonlyMap<string, FileIndex> } {
    return { files: this.files };
  }

  /**
   * Update or add a file to the index.
   * Returns the number of entries found in the file.
   */
  async updateFile(file: string, content: string): Promise<number> {
    if (this.disposed) throw new Error("Indexer disposed");
    this.files = updateFileInIndex(this.files, file, content);
    return this.files.get(file)?.entries.length ?? 0;
  }

  /** Remove a file from the index. */
  async removeFile(file: string): Promise<void> {
    if (this.disposed) throw new Error("Indexer disposed");
    this.files = removeFileFromIndex(this.files, file);
  }

  /** Query the index with the given filters. */
  async query(query: IndexQuery): Promise<readonly IndexEntry[]> {
    if (this.disposed) throw new Error("Indexer disposed");
    return queryIndex(this.getDocumentIndex(), query);
  }

  /** Query raw source text across indexed files. */
  async querySourceText(query: SourceTextQuery): Promise<readonly IndexEntry[]> {
    if (this.disposed) throw new Error("Indexer disposed");
    return querySourceText(this.getDocumentIndex(), query);
  }

  /** Resolve a label to its index entry. */
  async resolveLabel(label: string): Promise<IndexEntry | undefined> {
    if (this.disposed) throw new Error("Indexer disposed");
    return resolveLabel(this.getDocumentIndex(), label);
  }

  /** Find all references to a label across all files. */
  async findReferences(label: string): Promise<readonly ResolvedReference[]> {
    if (this.disposed) throw new Error("Indexer disposed");
    return findReferences(this.getDocumentIndex(), label);
  }

  /** Get the full index for a specific file. */
  async getFileIndex(file: string): Promise<FileIndex | undefined> {
    if (this.disposed) throw new Error("Indexer disposed");
    return this.files.get(file);
  }

  /** Get all labels from all indexed files. */
  async getAllLabels(): Promise<readonly string[]> {
    if (this.disposed) throw new Error("Indexer disposed");
    const labels: string[] = [];
    for (const [, fileIndex] of this.files) {
      for (const entry of fileIndex.entries) {
        if (entry.label !== undefined) {
          labels.push(entry.label);
        }
      }
    }
    return labels;
  }

  /** Bulk update multiple files at once. Returns total entry count. */
  async bulkUpdate(
    files: ReadonlyArray<{ file: string; content: string }>,
  ): Promise<number> {
    if (this.disposed) throw new Error("Indexer disposed");
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

  /** Mark the indexer as disposed. No-op cleanup (no worker to terminate). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.files.clear();
  }
}
