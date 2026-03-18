/**
 * Web worker that maintains a background index of all markdown files.
 *
 * Receives messages from the main thread to update file contents,
 * remove files, and respond to queries. All parsing happens off
 * the main thread for smooth editor performance.
 */

import type { FileIndex, IndexQuery, IndexEntry, ResolvedReference } from "./query-api";
import { queryIndex, resolveLabel, findReferences } from "./query-api";
import { extractFileIndex, updateFileInIndex, removeFileFromIndex } from "./extract";

/** Messages sent from main thread to worker. */
export type WorkerRequest =
  | { readonly kind: "update-file"; readonly id: number; readonly file: string; readonly content: string }
  | { readonly kind: "remove-file"; readonly id: number; readonly file: string }
  | { readonly kind: "query"; readonly id: number; readonly query: IndexQuery }
  | { readonly kind: "resolve-label"; readonly id: number; readonly label: string }
  | { readonly kind: "find-references"; readonly id: number; readonly label: string }
  | { readonly kind: "get-file-index"; readonly id: number; readonly file: string }
  | { readonly kind: "get-all-labels"; readonly id: number }
  | { readonly kind: "bulk-update"; readonly id: number; readonly files: ReadonlyArray<{ file: string; content: string }> };

/** Messages sent from worker back to main thread. */
export type WorkerResponse =
  | { readonly kind: "update-file-done"; readonly id: number; readonly entryCount: number }
  | { readonly kind: "remove-file-done"; readonly id: number }
  | { readonly kind: "query-result"; readonly id: number; readonly entries: readonly IndexEntry[] }
  | { readonly kind: "resolve-label-result"; readonly id: number; readonly entry: IndexEntry | undefined }
  | { readonly kind: "find-references-result"; readonly id: number; readonly references: readonly ResolvedReference[] }
  | { readonly kind: "file-index-result"; readonly id: number; readonly fileIndex: FileIndex | undefined }
  | { readonly kind: "all-labels-result"; readonly id: number; readonly labels: readonly string[] }
  | { readonly kind: "bulk-update-done"; readonly id: number; readonly totalEntries: number }
  | { readonly kind: "error"; readonly id: number; readonly message: string };

/** The in-memory index state. */
let files: Map<string, FileIndex> = new Map();

function getDocumentIndex(): { files: ReadonlyMap<string, FileIndex> } {
  return { files };
}

function handleMessage(request: WorkerRequest): WorkerResponse {
  switch (request.kind) {
    case "update-file": {
      files = updateFileInIndex(files, request.file, request.content);
      const fileIndex = files.get(request.file);
      return {
        kind: "update-file-done",
        id: request.id,
        entryCount: fileIndex?.entries.length ?? 0,
      };
    }

    case "remove-file": {
      files = removeFileFromIndex(files, request.file);
      return { kind: "remove-file-done", id: request.id };
    }

    case "query": {
      const entries = queryIndex(getDocumentIndex(), request.query);
      return { kind: "query-result", id: request.id, entries };
    }

    case "resolve-label": {
      const entry = resolveLabel(getDocumentIndex(), request.label);
      return { kind: "resolve-label-result", id: request.id, entry };
    }

    case "find-references": {
      const references = findReferences(getDocumentIndex(), request.label);
      return { kind: "find-references-result", id: request.id, references };
    }

    case "get-file-index": {
      const fileIndex = files.get(request.file);
      return { kind: "file-index-result", id: request.id, fileIndex };
    }

    case "get-all-labels": {
      const labels: string[] = [];
      for (const [, fileIndex] of files) {
        for (const entry of fileIndex.entries) {
          if (entry.label !== undefined) {
            labels.push(entry.label);
          }
        }
      }
      return { kind: "all-labels-result", id: request.id, labels };
    }

    case "bulk-update": {
      let totalEntries = 0;
      for (const { file, content } of request.files) {
        const fileIndex = extractFileIndex(content, file);
        files.set(file, fileIndex);
        totalEntries += fileIndex.entries.length;
      }
      return { kind: "bulk-update-done", id: request.id, totalEntries };
    }
  }
}

// Worker message handler
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const response = handleMessage(event.data);
    self.postMessage(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({
      kind: "error",
      id: event.data.id,
      message,
    } satisfies WorkerResponse);
  }
};
