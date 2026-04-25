import type { Tab } from "./tab-bar";

export type SessionDocument = Pick<Tab, "path" | "name" | "dirty">;

export type ExternalDocumentConflictKind = "deleted" | "modified";

export interface ExternalDocumentConflict {
  kind: ExternalDocumentConflictKind;
  path: string;
}

export interface EditorSessionState {
  currentDocument: SessionDocument | null;
  externalConflict: ExternalDocumentConflict | null;
}

export function createEditorSessionState(
  currentDocument: SessionDocument | null = null,
  externalConflict: ExternalDocumentConflict | null = null,
): EditorSessionState {
  return { currentDocument, externalConflict };
}

export function getCurrentSessionDocument(
  state: EditorSessionState,
): SessionDocument | null {
  return state.currentDocument;
}

export function hasSessionPath(
  state: EditorSessionState,
  path: string,
): boolean {
  return state.currentDocument?.path === path;
}

export function isCurrentSessionDirty(state: EditorSessionState): boolean {
  return state.currentDocument?.dirty === true;
}

export function isSessionPathDirty(
  state: EditorSessionState,
  path: string,
): boolean {
  return state.currentDocument?.path === path
    && state.currentDocument.dirty === true;
}
