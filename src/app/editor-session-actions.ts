import type {
  EditorSessionState,
  ExternalDocumentConflict,
  SessionDocument,
} from "./editor-session-model";

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

  return { ...state, currentDocument: { ...document } };
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
    ...state,
    externalConflict:
      state.externalConflict?.path === oldPath ? null : state.externalConflict,
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
  return {
    currentDocument: null,
    externalConflict: null,
  };
}

export function setExternalDocumentConflict(
  state: EditorSessionState,
  conflict: ExternalDocumentConflict,
): EditorSessionState {
  const current = state.externalConflict;
  if (current?.path === conflict.path && current.kind === conflict.kind) {
    return state;
  }
  return {
    ...state,
    externalConflict: { ...conflict },
  };
}

export function clearExternalDocumentConflict(
  state: EditorSessionState,
  path?: string,
): EditorSessionState {
  const current = state.externalConflict;
  if (!current || (path !== undefined && current.path !== path)) {
    return state;
  }
  return {
    ...state,
    externalConflict: null,
  };
}
