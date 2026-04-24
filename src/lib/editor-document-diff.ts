export interface EditorDocumentChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

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
