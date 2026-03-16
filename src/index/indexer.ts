/**
 * Main-thread interface to the background indexer web worker.
 *
 * Provides async methods for updating files and querying the index.
 * All heavy parsing happens in the worker; this class manages the
 * message protocol and pending request tracking.
 */

import type { IndexEntry, IndexQuery, FileIndex, ResolvedReference } from "./query-api";
import type { WorkerRequest, WorkerResponse } from "./indexer-worker";

/** Pending request tracker. */
interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
}

/**
 * Background document indexer that runs parsing in a web worker.
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
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private disposed = false;

  constructor() {
    this.worker = new Worker(
      new URL("./indexer-worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }

  /**
   * Update or add a file to the index.
   * Returns the number of entries found in the file.
   */
  async updateFile(file: string, content: string): Promise<number> {
    const response = await this.send({
      kind: "update-file",
      id: this.allocateId(),
      file,
      content,
    });
    if (response.kind === "update-file-done") {
      return response.entryCount;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Remove a file from the index. */
  async removeFile(file: string): Promise<void> {
    const response = await this.send({
      kind: "remove-file",
      id: this.allocateId(),
      file,
    });
    if (response.kind !== "remove-file-done") {
      throw new Error(`Unexpected response: ${response.kind}`);
    }
  }

  /** Query the index with the given filters. */
  async query(query: IndexQuery): Promise<readonly IndexEntry[]> {
    const response = await this.send({
      kind: "query",
      id: this.allocateId(),
      query,
    });
    if (response.kind === "query-result") {
      return response.entries;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Resolve a label to its index entry. */
  async resolveLabel(label: string): Promise<IndexEntry | undefined> {
    const response = await this.send({
      kind: "resolve-label",
      id: this.allocateId(),
      label,
    });
    if (response.kind === "resolve-label-result") {
      return response.entry;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Find all references to a label across all files. */
  async findReferences(label: string): Promise<readonly ResolvedReference[]> {
    const response = await this.send({
      kind: "find-references",
      id: this.allocateId(),
      label,
    });
    if (response.kind === "find-references-result") {
      return response.references;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Get the full index for a specific file. */
  async getFileIndex(file: string): Promise<FileIndex | undefined> {
    const response = await this.send({
      kind: "get-file-index",
      id: this.allocateId(),
      file,
    });
    if (response.kind === "file-index-result") {
      return response.fileIndex;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Get all labels from all indexed files. */
  async getAllLabels(): Promise<readonly string[]> {
    const response = await this.send({
      kind: "get-all-labels",
      id: this.allocateId(),
    });
    if (response.kind === "all-labels-result") {
      return response.labels;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Bulk update multiple files at once. Returns total entry count. */
  async bulkUpdate(
    files: ReadonlyArray<{ file: string; content: string }>,
  ): Promise<number> {
    const response = await this.send({
      kind: "bulk-update",
      id: this.allocateId(),
      files,
    });
    if (response.kind === "bulk-update-done") {
      return response.totalEntries;
    }
    throw new Error(`Unexpected response: ${response.kind}`);
  }

  /** Terminate the worker and reject all pending requests. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    for (const [, pending] of this.pending) {
      pending.reject(new Error("Indexer disposed"));
    }
    this.pending.clear();
  }

  private allocateId(): number {
    return this.nextId++;
  }

  private send(request: WorkerRequest): Promise<WorkerResponse> {
    if (this.disposed) {
      return Promise.reject(new Error("Indexer disposed"));
    }

    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private handleMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);

    if (response.kind === "error") {
      pending.reject(new Error(response.message));
    } else {
      pending.resolve(response);
    }
  }

  private handleError(event: ErrorEvent): void {
    // Reject all pending requests on worker error
    for (const [, pending] of this.pending) {
      pending.reject(new Error(`Worker error: ${event.message}`));
    }
    this.pending.clear();
  }
}
