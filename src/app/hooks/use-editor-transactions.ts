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

    const needsSelectionSnapshot =
      intent === "mode-switch"
      || intent === "search-navigation"
      || intent === "source-selection";

    const flushedDoc = handle.flushPendingEdits();
    if (needsSelectionSnapshot) {
      handle.getSelection();
    }
    const freshDoc = flushedDoc ?? handle.getDoc();
    const currentDoc = getSessionCurrentDocText();
    if (freshDoc !== currentDoc) {
      handleDocumentSnapshot(freshDoc);
      return {
        shouldDeferModeSwitch: true,
      };
    }
    if (freshDoc !== editorDoc) {
      handleDocumentSnapshot(freshDoc);
      return {
        shouldDeferModeSwitch: true,
      };
    }
    return {
      shouldDeferModeSwitch: false,
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
