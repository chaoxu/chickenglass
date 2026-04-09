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

import type { DocumentAnalysis } from "../semantics/document";
import {
  type CachedDocumentAnalysis,
  getCachedDocumentAnalysis,
  rememberCachedDocumentAnalysis,
} from "../semantics/incremental/cached-document-analysis";
import { extractFileIndex, removeFileFromIndex, updateFileInIndex } from "./extract";
import type {
  FileIndex,
  IndexEntry,
  IndexQuery,
  ResolvedReference,
  SourceTextQuery,
} from "./query-api";
import { findReferences, getAllLabels, queryIndex, querySourceText, resolveLabel } from "./query-api";

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
  private analyses = new Map<string, CachedDocumentAnalysis>();
  private disposed = false;

  private getDocumentIndex(): { files: ReadonlyMap<string, FileIndex> } {
    return { files: this.files };
  }

  private getNextAnalysis(
    file: string,
    content: string,
    analysis?: DocumentAnalysis,
  ): CachedDocumentAnalysis {
    const previous = this.analyses.get(file);
    return analysis
      ? rememberCachedDocumentAnalysis(content, analysis, previous)
      : getCachedDocumentAnalysis(content, previous);
  }

  /**
   * Update or add a single file without disturbing other indexed files.
   * Returns the number of entries found in the file.
   */
  async updateFile(
    file: string,
    content: string,
    analysis?: DocumentAnalysis,
  ): Promise<number> {
    if (this.disposed) throw new Error(`Indexer.updateFile("${file}"): indexer is disposed`);
    const nextAnalysis = this.getNextAnalysis(file, content, analysis);
    this.analyses.set(file, nextAnalysis);
    this.files = updateFileInIndex(this.files, file, content, nextAnalysis.analysis);
    return this.files.get(file)?.entries.length ?? 0;
  }

  /** Remove a file from the index. */
  async removeFile(file: string): Promise<void> {
    if (this.disposed) throw new Error(`Indexer.removeFile("${file}"): indexer is disposed`);
    this.files = removeFileFromIndex(this.files, file);
    this.analyses.delete(file);
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

  /** Resolve a label to its index entry. */
  async resolveLabel(label: string): Promise<IndexEntry | undefined> {
    if (this.disposed) throw new Error(`Indexer.resolveLabel("${label}"): indexer is disposed`);
    return resolveLabel(this.getDocumentIndex(), label);
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
    files: ReadonlyArray<{
      file: string;
      content: string;
      analysis?: DocumentAnalysis;
    }>,
  ): Promise<number> {
    if (this.disposed) throw new Error(`Indexer.bulkUpdate(${files.length} files): indexer is disposed`);
    const nextFiles = new Map<string, FileIndex>();
    const nextAnalyses = new Map<string, CachedDocumentAnalysis>();
    let totalEntries = 0;
    for (const { file, content, analysis } of files) {
      const nextAnalysis = this.getNextAnalysis(file, content, analysis);
      nextAnalyses.set(file, nextAnalysis);
      const fileIndex = extractFileIndex(content, file, nextAnalysis.analysis);
      nextFiles.set(file, fileIndex);
      totalEntries += fileIndex.entries.length;
    }
    this.files = nextFiles;
    this.analyses = nextAnalyses;
    return totalEntries;
  }

  /** Mark the indexer as disposed. No-op cleanup (no worker to terminate). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.files.clear();
    this.analyses.clear();
  }
}
