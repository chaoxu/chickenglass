import { basename } from "./lib/utils";
import {
  markSessionTabDirty,
  renameSessionTab,
} from "./editor-session-actions";
import type { EditorSessionState } from "./editor-session-model";

export interface ApplySaveAsResultOptions {
  state: EditorSessionState;
  buffers: Map<string, string>;
  liveDocs: Map<string, string>;
  oldPath: string;
  newPath: string;
  doc: string;
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

    return markSessionTabDirty(
      renameSessionTab(state, oldPath, newPath, basename(newPath)),
      newPath,
      false,
    );
  }

  buffers.set(newPath, doc);
  liveDocs.set(newPath, doc);
  return markSessionTabDirty(state, newPath, false);
}
