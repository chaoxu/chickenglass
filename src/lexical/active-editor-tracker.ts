import type { LexicalEditor } from "lexical";

let activeEditor: LexicalEditor | null = null;

export function getActiveEditor(): LexicalEditor | null {
  return activeEditor;
}

export function setActiveEditor(editor: LexicalEditor): void {
  activeEditor = editor;
}
