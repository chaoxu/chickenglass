import { useCallback } from "react";

export type EditorTransactionIntent =
  | "debug-read"
  | "mode-switch"
  | "save"
  | "search-navigation"
  | "source-selection";

export interface EditorTransactionResult<T> {
  readonly intent: EditorTransactionIntent;
  readonly value: T;
}

export function useEditorTransactions() {
  const runEditorTransaction = useCallback(<T>(
    intent: EditorTransactionIntent,
    body: () => T,
  ): EditorTransactionResult<T> => {
    return {
      intent,
      value: body(),
    };
  }, []);

  return {
    runEditorTransaction,
  };
}
