import { Text } from "@codemirror/state";

export interface EditorDocumentChange {
  from: number;
  to: number;
  insert: string;
}

export type EditorDocumentText = Text;

export const emptyEditorDocument = Text.empty;

export function createEditorDocumentText(doc: string): EditorDocumentText {
  if (doc.length === 0) {
    return emptyEditorDocument;
  }
  return Text.of(doc.split("\n"));
}

export function editorDocumentToString(doc: EditorDocumentText): string {
  return doc.toString();
}

export function applyEditorDocumentChanges(
  doc: EditorDocumentText,
  changes: readonly EditorDocumentChange[],
): EditorDocumentText {
  if (changes.length === 0) {
    return doc;
  }

  let nextDoc = doc;
  let nextFrom = doc.length;

  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (
      import.meta.env.DEV
      && (
        change.from < 0
        || change.to < change.from
        || change.to > nextFrom
      )
    ) {
      throw new Error("Editor document changes must be sorted, non-overlapping, and valid.");
    }
    nextDoc = nextDoc.replace(
      change.from,
      change.to,
      createEditorDocumentText(change.insert),
    );
    nextFrom = change.from;
  }

  return nextDoc;
}
