import { useCallback, type MutableRefObject } from "react";

import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";

export type EditorTransactionIntent =
  | "debug-read"
  | "mode-switch"
  | "save"
  | "search-navigation"
  | "source-selection";

export interface EditorTransactionFlushResult {
  readonly shouldDeferModeSwitch: boolean;
}

export interface EditorTransactionResult<T> {
  readonly intent: EditorTransactionIntent;
  readonly flush: EditorTransactionFlushResult;
  readonly value: T;
}

export interface UseEditorTransactionsOptions {
  readonly currentPath: string | null;
  readonly editorDoc: string;
  readonly editorHandleRef: MutableRefObject<MarkdownEditorHandle | null>;
  readonly getSessionCurrentDocText: () => string;
  readonly handleDocumentSnapshot: (doc: string) => void;
}

export function useEditorTransactions({
  currentPath,
  editorDoc,
  editorHandleRef,
  getSessionCurrentDocText,
  handleDocumentSnapshot,
}: UseEditorTransactionsOptions) {
  const flushPendingEditorEdits = useCallback((
    intent: EditorTransactionIntent,
  ): EditorTransactionFlushResult => {
    const handle = editorHandleRef.current;
    if (!handle || !currentPath) {
      return {
        shouldDeferModeSwitch: false,
      };
    }

    if (
      intent === "mode-switch"
      || intent === "search-navigation"
      || intent === "source-selection"
    ) {
      // Capture source-position intent before committing reveal/nested editors;
      // after commit the live Lexical selection may sit on the replacement node.
      handle.getSelection();
    }
    handle.flushPendingEdits();
    const freshDoc = handle.getDoc();
    const currentDoc = getSessionCurrentDocText();
    if (freshDoc !== currentDoc) {
      handleDocumentSnapshot(freshDoc);
      return {
        shouldDeferModeSwitch: true,
      };
    }
    return {
      shouldDeferModeSwitch: freshDoc !== editorDoc,
    };
  }, [
    currentPath,
    editorDoc,
    editorHandleRef,
    getSessionCurrentDocText,
    handleDocumentSnapshot,
  ]);

  const runEditorTransaction = useCallback(<T>(
    intent: EditorTransactionIntent,
    body: () => T,
  ): EditorTransactionResult<T> => {
    const flush = flushPendingEditorEdits(intent);
    return {
      intent,
      flush,
      value: body(),
    };
  }, [flushPendingEditorEdits]);

  return {
    flushPendingEditorEdits,
    runEditorTransaction,
  };
}
