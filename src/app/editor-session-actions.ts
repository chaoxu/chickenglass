import type { SessionDocument, EditorSessionState } from "./editor-session-model";

export function setCurrentSessionDocument(
  state: EditorSessionState,
  document: SessionDocument,
): EditorSessionState {
  if (
    state.currentDocument?.path === document.path
    && state.currentDocument.name === document.name
    && state.currentDocument.dirty === document.dirty
  ) {
    return state;
  }

  return { currentDocument: { ...document } };
}

export function markSessionDocumentDirty(
  state: EditorSessionState,
  path: string,
  dirty: boolean,
): EditorSessionState {
  const current = state.currentDocument;
  if (!current || current.path !== path || current.dirty === dirty) {
    return state;
  }

  return {
    currentDocument: {
      ...current,
      dirty,
    },
  };
}

export function renameSessionDocument(
  state: EditorSessionState,
  oldPath: string,
  newPath: string,
  newName: string,
): EditorSessionState {
  const current = state.currentDocument;
  if (!current || current.path !== oldPath) {
    return state;
  }

  return {
    currentDocument: {
      ...current,
      path: newPath,
      name: newName,
    },
  };
}

export function clearSessionDocument(
  state: EditorSessionState,
  path?: string,
): EditorSessionState {
  const current = state.currentDocument;
  if (!current) return state;
  if (path !== undefined && current.path !== path) return state;
  return { currentDocument: null };
}
