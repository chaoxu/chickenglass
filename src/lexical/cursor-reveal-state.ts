import type { LexicalEditor } from "lexical";

const activeRevealEditors = new WeakSet<LexicalEditor>();

export function setCursorRevealActive(editor: LexicalEditor, active: boolean): void {
  if (active) {
    activeRevealEditors.add(editor);
    return;
  }
  activeRevealEditors.delete(editor);
}

export function hasCursorRevealActive(editor: LexicalEditor): boolean {
  return activeRevealEditors.has(editor);
}
