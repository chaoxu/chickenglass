import type { EditorDocumentChange } from "../app/editor-doc-change";

export interface MarkdownEditorSelection {
  readonly anchor: number;
  readonly focus: number;
  readonly from: number;
  readonly to: number;
}

export interface MarkdownEditorHandle {
  applyChanges: (changes: readonly EditorDocumentChange[]) => void;
  focus: () => void;
  getDoc: () => string;
  getSelection: () => MarkdownEditorSelection;
  insertText: (text: string) => void;
  setDoc: (doc: string) => void;
  setSelection: (anchor: number, focus?: number) => void;
}
