export interface EditorDocumentChange {
  from: number;
  to: number;
  insert: string;
}

export function applyEditorDocumentChanges(
  doc: string,
  changes: readonly EditorDocumentChange[],
): string {
  if (changes.length === 0) {
    return doc;
  }

  let nextDoc = "";
  let cursor = 0;

  for (const change of changes) {
    nextDoc += doc.slice(cursor, change.from);
    nextDoc += change.insert;
    cursor = change.to;
  }

  nextDoc += doc.slice(cursor);
  return nextDoc;
}
