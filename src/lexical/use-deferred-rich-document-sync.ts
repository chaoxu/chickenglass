import { HISTORY_MERGE_TAG, type EditorUpdateOptions, type LexicalEditor } from "lexical";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { createMarkdownSelection } from "./editor-surface-shared";
import { applyIncrementalRichDocumentSync } from "./incremental-rich-sync";
import { setLexicalMarkdown } from "./markdown";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import type { RevealMode } from "./reveal-mode";
import {
  selectSourceOffsetsInRichLexicalNode,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-position-plugin";
import { COFLAT_DOCUMENT_SYNC_TAG } from "./update-tags";

const DEFAULT_DEFERRED_RICH_DOCUMENT_SYNC_MS = 75;

interface UseDeferredRichDocumentSyncArgs {
  readonly cacheRichDocumentSnapshot: (markdown: string) => void;
  readonly canonicalFallbackSelectionRef: MutableRefObject<MarkdownEditorSelection | null>;
  readonly delayMs?: number;
  readonly editor: LexicalEditor;
  readonly editorModeRef: MutableRefObject<RevealMode>;
  readonly richSelectionDomInsertFailedRef: MutableRefObject<boolean>;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly selectionSnapshotFreshRef: MutableRefObject<boolean>;
}

interface DeferredRichDocumentSyncController {
  readonly applyDeferredRichDocumentSync: () => void;
  readonly clearDeferredRichDocumentSync: () => void;
  readonly pendingDocRef: MutableRefObject<string | null>;
  readonly scheduleDeferredRichDocumentSync: (nextDoc: string, previousDoc: string) => void;
}

export function useDeferredRichDocumentSync({
  cacheRichDocumentSnapshot,
  canonicalFallbackSelectionRef,
  delayMs = DEFAULT_DEFERRED_RICH_DOCUMENT_SYNC_MS,
  editor,
  editorModeRef,
  richSelectionDomInsertFailedRef,
  selectionRef,
  selectionSnapshotFreshRef,
}: UseDeferredRichDocumentSyncArgs): DeferredRichDocumentSyncController {
  const deferredRichSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredRichSyncRequestRef = useRef(0);
  const deferredRichSyncDocRef = useRef<string | null>(null);
  const deferredRichSyncBaseDocRef = useRef<string | null>(null);

  const clearDeferredRichDocumentSync = useCallback(() => {
    deferredRichSyncRequestRef.current += 1;
    const timer = deferredRichSyncTimerRef.current;
    if (timer !== null) {
      clearTimeout(timer);
      deferredRichSyncTimerRef.current = null;
    }
  }, []);

  const applyDeferredRichDocumentSync = useCallback(() => {
    const nextDoc = deferredRichSyncDocRef.current;
    if (nextDoc === null || editorModeRef.current === "source") {
      clearDeferredRichDocumentSync();
      deferredRichSyncDocRef.current = null;
      deferredRichSyncBaseDocRef.current = null;
      return;
    }

    clearDeferredRichDocumentSync();
    deferredRichSyncDocRef.current = null;
    const previousDoc = deferredRichSyncBaseDocRef.current;
    deferredRichSyncBaseDocRef.current = null;
    const nextSelection = createMarkdownSelection(
      selectionRef.current.anchor,
      selectionRef.current.focus,
      nextDoc.length,
    );
    selectionRef.current = nextSelection;
    const syncOptions: Pick<EditorUpdateOptions, "tag"> = {
      tag: [HISTORY_MERGE_TAG, COFLAT_DOCUMENT_SYNC_TAG],
    };
    const incrementalSyncResult = previousDoc !== null
      ? applyIncrementalRichDocumentSync(editor, previousDoc, nextDoc, syncOptions)
      : { applied: false as const };
    if (!incrementalSyncResult.applied) {
      setLexicalMarkdown(editor, nextDoc, syncOptions);
    }
    let moved = false;
    if (
      incrementalSyncResult.applied
      && nextSelection.from >= incrementalSyncResult.blockFrom
      && nextSelection.to <= incrementalSyncResult.nextBlockTo
    ) {
      moved = selectSourceOffsetsInRichLexicalNode(
        editor,
        incrementalSyncResult.nodeKey,
        incrementalSyncResult.nextBlockSource,
        incrementalSyncResult.blockFrom,
        nextSelection.anchor,
        nextSelection.focus,
      );
    }
    if (!moved) {
      moved = selectSourceOffsetsInRichLexicalRoot(
        editor,
        nextDoc,
        nextSelection.anchor,
        nextSelection.focus,
      );
    }
    selectionSnapshotFreshRef.current = moved;
    richSelectionDomInsertFailedRef.current = !moved;
    canonicalFallbackSelectionRef.current = moved ? null : nextSelection;
    cacheRichDocumentSnapshot(nextDoc);
  }, [
    cacheRichDocumentSnapshot,
    canonicalFallbackSelectionRef,
    clearDeferredRichDocumentSync,
    editor,
    editorModeRef,
    richSelectionDomInsertFailedRef,
    selectionRef,
    selectionSnapshotFreshRef,
  ]);

  const scheduleDeferredRichDocumentSync = useCallback((nextDoc: string, previousDoc: string) => {
    if (deferredRichSyncDocRef.current === null) {
      deferredRichSyncBaseDocRef.current = previousDoc;
    }
    deferredRichSyncDocRef.current = nextDoc;
    clearDeferredRichDocumentSync();
    const request = deferredRichSyncRequestRef.current;
    deferredRichSyncTimerRef.current = setTimeout(() => {
      if (deferredRichSyncRequestRef.current !== request) {
        return;
      }
      applyDeferredRichDocumentSync();
    }, delayMs);
  }, [applyDeferredRichDocumentSync, clearDeferredRichDocumentSync, delayMs]);

  useEffect(() => () => {
    clearDeferredRichDocumentSync();
    deferredRichSyncDocRef.current = null;
    deferredRichSyncBaseDocRef.current = null;
  }, [clearDeferredRichDocumentSync]);

  return {
    applyDeferredRichDocumentSync,
    clearDeferredRichDocumentSync,
    pendingDocRef: deferredRichSyncDocRef,
    scheduleDeferredRichDocumentSync,
  };
}
