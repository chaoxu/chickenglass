import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { LexicalNode } from "lexical";

import {
  applyEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/editor-doc-change";
import { createSourceSpanIndex } from "./source-spans";

interface DocumentChangeBridge {
  readonly createNodeSourceReplacement: (
    node: LexicalNode,
    expectedSource: string,
    nextSource: string,
  ) => EditorDocumentChange | null;
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

  const createNodeSourceReplacement = useCallback((
    node: LexicalNode,
    expectedSource: string,
    nextSource: string,
  ): EditorDocumentChange | null => {
    if (expectedSource === nextSource) {
      return null;
    }

    const currentDoc = lastCommittedDocRef.current;
    const spans = createSourceSpanIndex(currentDoc);
    const from = spans.getNodeStart(node);
    const to = spans.getNodeEnd(node);
    return from === null || to === null
      ? null
      : createSourceReplacement({ from, to }, expectedSource, nextSource);
  }, [createSourceReplacement, lastCommittedDocRef]);

  const publishChanges = useCallback((changes: readonly EditorDocumentChange[]) => {
    if (changes.length === 0) {
      return;
    }

    const currentDoc = lastCommittedDocRef.current;
    const nextDoc = applyEditorDocumentChanges(currentDoc, changes);
    if (nextDoc === currentDoc) {
      return;
    }

    pendingLocalEchoDocRef.current = nextDoc;
    lastCommittedDocRef.current = nextDoc;
    onTextChange?.(nextDoc);
    onDocChange?.(changes);
  }, [lastCommittedDocRef, onDocChange, onTextChange, pendingLocalEchoDocRef]);

  const value = useMemo((): DocumentChangeBridge => ({
    createNodeSourceReplacement,
    createSourceReplacement,
    publishChanges,
  }), [createNodeSourceReplacement, createSourceReplacement, publishChanges]);

  return (
    <DocumentChangeBridgeContext.Provider value={value}>
      {children}
    </DocumentChangeBridgeContext.Provider>
  );
}
