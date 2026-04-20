export interface EditorDocumentChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export type EditorDocumentText = string;

export const emptyEditorDocument = "";

export function createEditorDocumentText(doc: string): EditorDocumentText {
  return doc;
}

export function editorDocumentToString(doc: EditorDocumentText): string {
  return doc;
}

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

export function createMinimalEditorDocumentChanges(
  previousDoc: string,
  nextDoc: string,
): EditorDocumentChange[] {
  if (previousDoc === nextDoc) {
    return [];
  }

  let start = 0;
  const maxPrefix = Math.min(previousDoc.length, nextDoc.length);
  while (
    start < maxPrefix
    && previousDoc.charCodeAt(start) === nextDoc.charCodeAt(start)
  ) {
    start += 1;
  }

  let previousEnd = previousDoc.length;
  let nextEnd = nextDoc.length;
  while (
    previousEnd > start
    && nextEnd > start
    && previousDoc.charCodeAt(previousEnd - 1) === nextDoc.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return [{
    from: start,
    to: previousEnd,
    insert: nextDoc.slice(start, nextEnd),
  }];
}
