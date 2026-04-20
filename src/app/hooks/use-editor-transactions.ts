import { useCallback, type MutableRefObject } from "react";

import { createMinimalEditorDocumentChanges } from "../../lib/editor-doc-change";
import type { MarkdownEditorHandle } from "../../lexical/markdown-editor-types";
import type { EditorDocumentChange } from "../../lib/editor-doc-change";

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
  readonly handleDocChange: (changes: readonly EditorDocumentChange[]) => void;
}

export function useEditorTransactions({
  currentPath,
  editorDoc,
  editorHandleRef,
  getSessionCurrentDocText,
  handleDocChange,
}: UseEditorTransactionsOptions) {
  const flushPendingEditorEdits = useCallback((): EditorTransactionFlushResult => {
    const handle = editorHandleRef.current;
    if (!handle || !currentPath) {
      return {
        shouldDeferModeSwitch: false,
      };
    }

    // Capture source-position intent before committing reveal/nested editors;
    // after commit the live Lexical selection may sit on the replacement node.
    handle.getSelection();
    handle.flushPendingEdits();
    const freshDoc = handle.peekDoc();
    const currentDoc = getSessionCurrentDocText();
    const changes = createMinimalEditorDocumentChanges(currentDoc, freshDoc);
    if (changes.length > 0) {
      handleDocChange(changes);
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
    handleDocChange,
  ]);

  const runEditorTransaction = useCallback(<T>(
    intent: EditorTransactionIntent,
    body: () => T,
  ): EditorTransactionResult<T> => {
    const flush = flushPendingEditorEdits();
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
