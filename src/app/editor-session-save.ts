import { basename } from "./lib/utils";
import type { EditorDocumentText } from "./editor-doc-change";
import {
  clearExternalDocumentConflict,
  renameSessionDocument,
} from "./editor-session-actions";
import { setSessionPathDirty } from "./editor-session-dirty-state";
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

    return clearExternalDocumentConflict(
      setSessionPathDirty(
        renameSessionDocument(state, oldPath, newPath, basename(newPath)),
        newPath,
        false,
      ),
      oldPath,
    );
  }

  buffers.set(newPath, doc);
  liveDocs.set(newPath, doc);
  return clearExternalDocumentConflict(
    setSessionPathDirty(state, newPath, false),
    oldPath,
  );
}
