import type { EditorSessionState } from "./editor-session-model";

export function hasDirtySessionDocument(state: EditorSessionState): boolean {
  return state.currentDocument?.dirty === true;
}

export function isSessionPathDirty(
  state: EditorSessionState,
  path: string,
): boolean {
  return state.currentDocument?.path === path
    && state.currentDocument.dirty === true;
}

export function setSessionPathDirty(
  state: EditorSessionState,
  path: string,
  dirty: boolean,
): EditorSessionState {
  const current = state.currentDocument;
  if (!current || current.path !== path || current.dirty === dirty) {
    return state;
  }

  return {
    ...state,
    currentDocument: {
      ...current,
      dirty,
    },
  };
}
