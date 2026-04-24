import {
  applyStringEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/string-editor-document-change";

interface MutableRef<T> {
  current: T;
}

interface LexicalDocumentPublicationTarget {
  readonly lastCommittedDocRef: MutableRef<string>;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingLocalEchoDocRef: MutableRef<string | null>;
  readonly userEditPendingRef?: MutableRef<boolean>;
}

export interface LexicalDocumentPublicationResult {
  readonly changes: readonly EditorDocumentChange[];
  readonly changed: boolean;
  readonly nextDoc: string;
  readonly previousDoc: string;
}

export function publishLexicalDocumentSnapshot(
  target: LexicalDocumentPublicationTarget,
  nextDoc: string,
): LexicalDocumentPublicationResult {
  const previousDoc = target.lastCommittedDocRef.current;
  const changes = createMinimalEditorDocumentChanges(previousDoc, nextDoc);
  if (changes.length === 0) {
    if (target.userEditPendingRef) {
      target.userEditPendingRef.current = false;
    }
    return {
      changed: false,
      changes,
      nextDoc,
      previousDoc,
    };
  }

  target.pendingLocalEchoDocRef.current = nextDoc;
  target.lastCommittedDocRef.current = nextDoc;
  if (target.userEditPendingRef) {
    target.userEditPendingRef.current = false;
  }
  target.onTextChange?.(nextDoc);
  target.onDocChange?.(changes);
  return {
    changed: true,
    changes,
    nextDoc,
    previousDoc,
  };
}

export function publishLexicalDocumentChanges(
  target: LexicalDocumentPublicationTarget,
  changes: readonly EditorDocumentChange[],
): LexicalDocumentPublicationResult {
  const previousDoc = target.lastCommittedDocRef.current;
  if (changes.length === 0) {
    return {
      changed: false,
      changes,
      nextDoc: previousDoc,
      previousDoc,
    };
  }

  const nextDoc = applyStringEditorDocumentChanges(previousDoc, changes);
  if (nextDoc === previousDoc) {
    return {
      changed: false,
      changes: [],
      nextDoc,
      previousDoc,
    };
  }

  target.pendingLocalEchoDocRef.current = nextDoc;
  target.lastCommittedDocRef.current = nextDoc;
  if (target.userEditPendingRef) {
    target.userEditPendingRef.current = false;
  }
  target.onTextChange?.(nextDoc);
  target.onDocChange?.(changes);
  return {
    changed: true,
    changes,
    nextDoc,
    previousDoc,
  };
}
