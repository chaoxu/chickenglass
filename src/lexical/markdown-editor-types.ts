import type { MarkdownEditorSelection } from "../lib/debug-types";
import type { EditorDocumentChange } from "../lib/string-editor-document-change";

export type { MarkdownEditorSelection } from "../lib/debug-types";

export interface MarkdownEditorHandle {
  applyChanges: (changes: readonly EditorDocumentChange[]) => void;
  focus: () => void;
  flushPendingEdits: () => string | null;
  getDoc: () => string;
  getSelection: () => MarkdownEditorSelection;
  peekDoc: () => string;
  peekSelection: () => MarkdownEditorSelection;
  insertText: (text: string) => void;
  setDoc: (doc: string) => void;
  setSelection: (anchor: number, focus?: number, options?: { skipScrollIntoView?: boolean }) => void;
}
