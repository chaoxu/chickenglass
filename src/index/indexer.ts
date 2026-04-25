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

import {
  extractFileIndex,
  type FileIndexAnalysisInput,
  removeFileFromIndex,
  updateFileInIndex,
} from "./extract";
import type {
  DocumentIndex,
  FileIndex,
  IndexEntry,
  IndexQuery,
  LabelResolution,
  ResolvedReference,
  SourceTextQuery,
} from "./query-api";
import {
  findReferences,
  getAllLabels,
  queryIndex,
  querySourceText,
  resolveLabel,
  resolveLabelResolution,
  resolveLabelTargets,
} from "./query-api";

export interface IndexFileSnapshot {
  readonly file: string;
  readonly content: string;
  readonly analysis?: FileIndexAnalysisInput;
}

export interface ChunkedBulkUpdateOptions {
  readonly batchSize?: number;
  readonly yieldAfterBatch?: () => Promise<void>;
  readonly shouldCancel?: () => boolean;
}

export interface DeferredUpdateFileOptions {
  readonly shouldCancel?: () => boolean;
  readonly yieldBeforeUpdate?: () => Promise<void>;
}

const DEFAULT_CHUNKED_BULK_UPDATE_BATCH_SIZE = 25;

function normalizeChunkedBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined) {
    return DEFAULT_CHUNKED_BULK_UPDATE_BATCH_SIZE;
  }
  return Math.max(1, Math.floor(batchSize));
}

function yieldAfterMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

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
  private revision = 0;
  private documentIndexSnapshot: DocumentIndex | null = null;

  private commitFiles(files: Map<string, FileIndex>): void {
    this.files = files;
    this.revision += 1;
    this.documentIndexSnapshot = null;
  }

  private getDocumentIndex(): DocumentIndex {
    if (this.documentIndexSnapshot) {
      return this.documentIndexSnapshot;
    }
    const snapshot: DocumentIndex = Object.freeze({
      revision: this.revision,
      files: new Map(this.files),
    });
    this.documentIndexSnapshot = snapshot;
    return snapshot;
  }

  /**
   * Update or add a single file without disturbing other indexed files.
   * Returns the number of entries found in the file.
   */
  async updateFile(
    file: string,
    content: string,
    analysis?: FileIndexAnalysisInput,
  ): Promise<number> {
    if (this.disposed) throw new Error(`Indexer.updateFile("${file}"): indexer is disposed`);
    this.commitFiles(updateFileInIndex(this.files, file, content, analysis));
    return this.files.get(file)?.entries.length ?? 0;
  }

  /**
   * Update a single file after yielding once so stale active-file sync work can
   * be cancelled before extraction begins.
   *
   * Returns `null` if `shouldCancel()` becomes true before the update commits,
   * leaving the previous file snapshot intact.
   */
  async updateFileDeferred(
    file: string,
    content: string,
    analysis?: FileIndexAnalysisInput,
    options: DeferredUpdateFileOptions = {},
  ): Promise<number | null> {
    if (this.disposed) {
      throw new Error(`Indexer.updateFileDeferred("${file}"): indexer is disposed`);
    }
    const shouldCancel = options.shouldCancel ?? (() => false);
    const yieldBeforeUpdate = options.yieldBeforeUpdate ?? yieldAfterMacrotask;
    if (shouldCancel()) {
      return null;
    }

    await yieldBeforeUpdate();

    if (this.disposed) {
      throw new Error(`Indexer.updateFileDeferred("${file}"): indexer is disposed`);
    }
    if (shouldCancel()) {
      return null;
    }
    this.commitFiles(updateFileInIndex(this.files, file, content, analysis));
    return this.files.get(file)?.entries.length ?? 0;
  }

  /** Remove a file from the index. */
  async removeFile(file: string): Promise<void> {
    if (this.disposed) throw new Error(`Indexer.removeFile("${file}"): indexer is disposed`);
    this.commitFiles(removeFileFromIndex(this.files, file));
  }

  /** Query the index with the given filters. */
  async query(query: IndexQuery): Promise<readonly IndexEntry[]> {
    if (this.disposed) throw new Error("Indexer.query: indexer is disposed");
    return queryIndex(this.getDocumentIndex(), query);
  }

  /** Query raw source text across indexed files. */
  async querySourceText(query: SourceTextQuery): Promise<readonly IndexEntry[]> {
    if (this.disposed) throw new Error("Indexer.querySourceText: indexer is disposed");
    return querySourceText(this.getDocumentIndex(), query);
  }

  /** Resolve a label to its unique index entry. */
  async resolveLabel(label: string): Promise<IndexEntry | undefined> {
    if (this.disposed) throw new Error(`Indexer.resolveLabel("${label}"): indexer is disposed`);
    return resolveLabel(this.getDocumentIndex(), label);
  }

  /** Resolve a label to all matching index entries. */
  async resolveLabelTargets(label: string): Promise<readonly IndexEntry[]> {
    if (this.disposed) throw new Error(`Indexer.resolveLabelTargets("${label}"): indexer is disposed`);
    return resolveLabelTargets(this.getDocumentIndex(), label);
  }

  /** Resolve a label to a missing/unique/ambiguous result. */
  async resolveLabelResolution(label: string): Promise<LabelResolution> {
    if (this.disposed) throw new Error(`Indexer.resolveLabelResolution("${label}"): indexer is disposed`);
    return resolveLabelResolution(this.getDocumentIndex(), label);
  }

  /** Find all references to a label across all files. */
  async findReferences(label: string): Promise<readonly ResolvedReference[]> {
    if (this.disposed) throw new Error(`Indexer.findReferences("${label}"): indexer is disposed`);
    return findReferences(this.getDocumentIndex(), label);
  }

  /** Get the full index for a specific file. */
  async getFileIndex(file: string): Promise<FileIndex | undefined> {
    if (this.disposed) throw new Error(`Indexer.getFileIndex("${file}"): indexer is disposed`);
    return this.files.get(file);
  }

  /** Get all labels from all indexed files. */
  async getAllLabels(): Promise<readonly string[]> {
    if (this.disposed) throw new Error("Indexer.getAllLabels: indexer is disposed");
    return getAllLabels(this.getDocumentIndex());
  }

  /**
   * Rebuild the index from an exact file snapshot. Files omitted from this
   * batch are removed; use `updateFile()` / `removeFile()` for incremental sync.
   * Returns the total entry count in the rebuilt index.
   */
  async bulkUpdate(
    files: ReadonlyArray<IndexFileSnapshot>,
  ): Promise<number> {
    if (this.disposed) throw new Error(`Indexer.bulkUpdate(${files.length} files): indexer is disposed`);
    const nextFiles = new Map<string, FileIndex>();
    let totalEntries = 0;
    for (const { file, content, analysis } of files) {
      const fileIndex = extractFileIndex(content, file, analysis);
      nextFiles.set(file, fileIndex);
      totalEntries += fileIndex.entries.length;
    }
    this.commitFiles(nextFiles);
    return totalEntries;
  }

  /**
   * Rebuild the index from an exact file snapshot while yielding between
   * batches. This keeps large project-wide rebuilds responsive without
   * changing the final replacement semantics of `bulkUpdate()`.
   *
   * Returns `null` if `shouldCancel()` becomes true before the new snapshot is
   * committed, leaving the previous index untouched.
   */
  async bulkUpdateChunked(
    files: ReadonlyArray<IndexFileSnapshot>,
    options: ChunkedBulkUpdateOptions = {},
  ): Promise<number | null> {
    if (this.disposed) {
      throw new Error(`Indexer.bulkUpdateChunked(${files.length} files): indexer is disposed`);
    }
    const batchSize = normalizeChunkedBatchSize(options.batchSize);
    const yieldAfterBatch = options.yieldAfterBatch ?? yieldAfterMacrotask;
    const shouldCancel = options.shouldCancel ?? (() => false);
    const nextFiles = new Map<string, FileIndex>();
    let totalEntries = 0;

    for (let index = 0; index < files.length; index += 1) {
      if (this.disposed) {
        throw new Error(`Indexer.bulkUpdateChunked(${files.length} files): indexer is disposed`);
      }
      if (shouldCancel()) {
        return null;
      }

      const { file, content, analysis } = files[index];
      const fileIndex = extractFileIndex(content, file, analysis);
      nextFiles.set(file, fileIndex);
      totalEntries += fileIndex.entries.length;

      const processedCount = index + 1;
      if (processedCount < files.length && processedCount % batchSize === 0) {
        await yieldAfterBatch();
      }
    }

    if (this.disposed) {
      throw new Error(`Indexer.bulkUpdateChunked(${files.length} files): indexer is disposed`);
    }
    if (shouldCancel()) {
      return null;
    }
    this.commitFiles(nextFiles);
    return totalEntries;
  }

  /** Mark the indexer as disposed. No-op cleanup (no worker to terminate). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.files.clear();
    this.revision += 1;
    this.documentIndexSnapshot = null;
  }
}
