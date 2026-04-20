import {
  editorDocumentToString,
  emptyEditorDocument,
  type EditorDocumentText,
} from "../lib/editor-doc-change";
import type { EditorSessionRuntime } from "./editor-session-runtime";
import type { SourceMap } from "./source-map";

/**
 * Low-level helpers for EditorSessionStore. Service and persistence should not
 * import this module directly; they request explicit store operations instead.
 */

/** Drop all cached state for `path` from the runtime. */
export function clearPathBuffers(runtime: EditorSessionRuntime, path: string): void {
  runtime.pipeline.clear(path);
  runtime.buffers.delete(path);
  runtime.liveDocs.delete(path);
  runtime.sourceMaps.delete(path);
}

/** Drop buffers + sourceMap for `path` but leave the pipeline as-is. */
export function clearPathBuffersKeepPipeline(runtime: EditorSessionRuntime, path: string): void {
  runtime.buffers.delete(path);
  runtime.liveDocs.delete(path);
  runtime.sourceMaps.delete(path);
}

/** Seed buffers with freshly loaded (or reloaded) document content. */
export function installPathDocument(
  runtime: EditorSessionRuntime,
  path: string,
  documentText: EditorDocumentText,
  rawContent: string,
  sourceMap: SourceMap | null,
): void {
  if (sourceMap) {
    runtime.sourceMaps.set(path, sourceMap);
  }
  runtime.buffers.set(path, documentText);
  runtime.liveDocs.set(path, documentText);
  runtime.pipeline.initPath(path, rawContent);
}

/** Revert live document back to the saved buffer for `path`. */
export function resetLiveDocToBuffer(runtime: EditorSessionRuntime, path: string): EditorDocumentText {
  const savedDoc = runtime.buffers.get(path) ?? emptyEditorDocument;
  runtime.liveDocs.set(path, savedDoc);
  return savedDoc;
}

/** Read the best-effort current document text for `path` (live → saved → empty). */
export function readDocumentText(runtime: EditorSessionRuntime, path: string | null): string {
  if (!path) return "";
  return editorDocumentToString(
    runtime.liveDocs.get(path)
    ?? runtime.buffers.get(path)
    ?? emptyEditorDocument,
  );
}

/** Move buffers + sourceMap + pipeline from `oldPath` to `newPath`. */
export function renamePathBuffers(
  runtime: EditorSessionRuntime,
  oldPath: string,
  newPath: string,
  rawDiskContent?: string,
): { buffered?: EditorDocumentText; liveDoc?: EditorDocumentText } {
  const buffered = runtime.buffers.get(oldPath);
  if (buffered !== undefined) {
    runtime.buffers.delete(oldPath);
    runtime.buffers.set(newPath, buffered);
  }

  const liveDoc = runtime.liveDocs.get(oldPath);
  if (liveDoc !== undefined) {
    runtime.liveDocs.delete(oldPath);
    runtime.liveDocs.set(newPath, liveDoc);
  }

  const sourceMap = runtime.sourceMaps.get(oldPath);
  if (sourceMap) {
    runtime.sourceMaps.delete(oldPath);
    runtime.sourceMaps.set(newPath, sourceMap);
  }

  runtime.pipeline.clear(oldPath);
  runtime.pipeline.initPath(
    newPath,
    rawDiskContent ?? editorDocumentToString(liveDoc ?? buffered ?? emptyEditorDocument),
  );

  return { buffered, liveDoc };
}
