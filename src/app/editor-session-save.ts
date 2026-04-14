import { basename } from "./lib/utils";
import type { EditorDocumentText } from "../lib/editor-doc-change";
import {
  markSessionDocumentDirty,
  renameSessionDocument,
} from "./editor-session-actions";
import type { EditorSessionState } from "./editor-session-model";

export interface ApplySaveAsResultOptions {
  state: EditorSessionState;
  buffers: Map<string, EditorDocumentText>;
  liveDocs: Map<string, EditorDocumentText>;
  oldPath: string;
  newPath: string;
  doc: EditorDocumentText;
}

/**
 * Update in-memory editor session state after a successful Save As.
 */
export function applySaveAsResult({
  state,
  buffers,
  liveDocs,
  oldPath,
  newPath,
  doc,
}: ApplySaveAsResultOptions): EditorSessionState {
  if (oldPath !== newPath) {
    const buffered = buffers.get(oldPath);
    if (buffered !== undefined) {
      buffers.delete(oldPath);
    }
    buffers.set(newPath, doc);

    const liveDoc = liveDocs.get(oldPath);
    if (liveDoc !== undefined) {
      liveDocs.delete(oldPath);
    }
    liveDocs.set(newPath, doc);

    return markSessionDocumentDirty(
      renameSessionDocument(state, oldPath, newPath, basename(newPath)),
      newPath,
      false,
    );
  }

  buffers.set(newPath, doc);
  liveDocs.set(newPath, doc);
  return markSessionDocumentDirty(state, newPath, false);
}
