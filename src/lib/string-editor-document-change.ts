import type { EditorDocumentChange } from "./editor-document-diff";

export {
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "./editor-document-diff";

export type StringEditorDocumentText = string;
export type EditorDocumentText = StringEditorDocumentText;

export const emptyStringEditorDocument = "";
export const emptyEditorDocument = emptyStringEditorDocument;

export function createStringEditorDocumentText(doc: string): StringEditorDocumentText {
  return doc;
}

export const createEditorDocumentText = createStringEditorDocumentText;

export function stringEditorDocumentToString(doc: StringEditorDocumentText): string {
  return doc;
}

export const editorDocumentToString = stringEditorDocumentToString;

export function applyStringEditorDocumentChanges(
  doc: string,
  changes: readonly EditorDocumentChange[],
): string {
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
    nextDoc = `${nextDoc.slice(0, change.from)}${change.insert}${nextDoc.slice(change.to)}`;
    nextFrom = change.from;
  }

  return nextDoc;
}

export const applyEditorDocumentChanges = applyStringEditorDocumentChanges;
