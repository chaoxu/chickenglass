import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";

import type { EditorDocumentChange } from "../lib/string-editor-document-change";
import { publishLexicalDocumentChanges } from "./document-publication";

interface DocumentChangeBridge {
  readonly createSourceReplacement: (
    range: { readonly from: number; readonly to: number },
    expectedSource: string,
    nextSource: string,
  ) => EditorDocumentChange | null;
  readonly publishChanges: (changes: readonly EditorDocumentChange[]) => void;
}

const DocumentChangeBridgeContext = createContext<DocumentChangeBridge | null>(null);

export function useDocumentChangeBridge(): DocumentChangeBridge | null {
  return useContext(DocumentChangeBridgeContext);
}

export function DocumentChangeBridgeProvider({
  children,
  lastCommittedDocRef,
  onDocChange,
  onTextChange,
  pendingLocalEchoDocRef,
}: {
  readonly children: ReactNode;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
}) {
  const createSourceReplacement = useCallback((
    range: { readonly from: number; readonly to: number },
    expectedSource: string,
    nextSource: string,
  ): EditorDocumentChange | null => {
    if (expectedSource === nextSource) {
      return null;
    }

    const currentDoc = lastCommittedDocRef.current;
    const { from, to } = range;
    if (from === null || to === null || currentDoc.slice(from, to) !== expectedSource) {
      return null;
    }

    return {
      from,
      insert: nextSource,
      to,
    };
  }, [lastCommittedDocRef]);

  const publishChanges = useCallback((changes: readonly EditorDocumentChange[]) => {
    if (changes.length === 0) {
      return;
    }

    publishLexicalDocumentChanges({
      lastCommittedDocRef,
      onDocChange,
      onTextChange,
      pendingLocalEchoDocRef,
    }, changes);
  }, [lastCommittedDocRef, onDocChange, onTextChange, pendingLocalEchoDocRef]);

  const value = useMemo((): DocumentChangeBridge => ({
    createSourceReplacement,
    publishChanges,
  }), [createSourceReplacement, publishChanges]);

  return (
    <DocumentChangeBridgeContext.Provider value={value}>
      {children}
    </DocumentChangeBridgeContext.Provider>
  );
}
