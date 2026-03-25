import type { Tab } from "./tab-bar";

export type SessionDocument = Pick<Tab, "path" | "name" | "dirty">;

export interface EditorSessionState {
  currentDocument: SessionDocument | null;
}

export function createEditorSessionState(
  currentDocument: SessionDocument | null = null,
): EditorSessionState {
  return { currentDocument };
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
