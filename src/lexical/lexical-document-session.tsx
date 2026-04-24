import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  CLEAR_HISTORY_COMMAND,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  PASTE_TAG,
} from "lexical";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef } from "react";
import type { EditorDocumentChange } from "../lib/string-editor-document-change";
import type { SurfaceFocusOwner } from "../state/editor-focus";
import { publishLexicalDocumentSnapshot } from "./document-publication";
import {
  replaceSourceText,
  shouldIgnoreMarkdownEditorChange,
} from "./document-session-helpers";
import {
  createMarkdownSelection,
} from "./editor-surface-shared";
import {
  createEmbeddedFieldFlushRegistry,
} from "./embedded-field-flush-registry";
import {
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import type { RevealMode } from "./reveal-mode";
import {
  readSourceSelectionFromLexicalSelection,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-position-plugin";
import {
  COFLAT_DOCUMENT_SYNC_TAG,
  COFLAT_FORMAT_COMMIT_TAG,
  COFLAT_NESTED_EDIT_TAG,
  COFLAT_REVEAL_COMMIT_TAG,
} from "./update-tags";
import {
  useRichDocumentSnapshotPublisher,
} from "./use-rich-document-snapshot-publisher";

export {
  readEditorDocument,
  replaceSourceText,
  shouldIgnoreMarkdownEditorChange,
} from "./document-session-helpers";
export { readEmbeddedInlineDomSelection } from "./embedded-selection";
export { canReadLiveSelectionFromEditor, sameSelection } from "./selection-helpers";

export interface LexicalDocumentSessionController {
  readonly initialDocRef: MutableRefObject<string>;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly canonicalBridgeEchoRef: MutableRefObject<boolean>;
  readonly sourceSelectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
  readonly focusOwnerRef: MutableRefObject<SurfaceFocusOwner>;
  readonly embeddedFieldFlushRegistry: ReturnType<typeof createEmbeddedFieldFlushRegistry>;
  readonly cancelRichDocumentSnapshot: () => void;
  readonly flushRichDocumentSnapshot: () => string | null;
  readonly handleRichChange: (editor: LexicalEditor, tags: Set<string>) => void;
  readonly syncSelectionToDocLength: (docLength: number) => void;
}

type RichChangePolicy = "markdown" | "dirty";

function isUserCommittedRichChange(
  requireUserEditFlag: boolean,
  userEditPending: boolean,
  tags: Set<string>,
): boolean {
  return !requireUserEditFlag
    || userEditPending
    || tags.has(COFLAT_FORMAT_COMMIT_TAG)
    || tags.has(COFLAT_NESTED_EDIT_TAG)
    || tags.has(COFLAT_REVEAL_COMMIT_TAG)
    || tags.has(PASTE_TAG);
}

export function useLexicalDocumentSessionController({
  doc,
  focusOwner,
  onDocChange,
  onDirtyChange,
  onSelectionChange,
  onTextChange,
  requireUserEditFlag = true,
  richChangePolicy = "markdown",
}: {
  readonly doc: string;
  readonly focusOwner: SurfaceFocusOwner;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onDirtyChange?: () => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly requireUserEditFlag?: boolean;
  readonly richChangePolicy?: RichChangePolicy;
}): LexicalDocumentSessionController {
  const initialDocRef = useRef(doc);
  const lastCommittedDocRef = useRef(doc);
  const pendingLocalEchoDocRef = useRef<string | null>(null);
  const canonicalBridgeEchoRef = useRef(false);
  const sourceSelectionRef = useRef<MarkdownEditorSelection>(createMarkdownSelection(0));
  const userEditPendingRef = useRef(false);
  const focusOwnerRef = useRef(focusOwner);
  const embeddedFieldFlushRegistry = useMemo(createEmbeddedFieldFlushRegistry, []);
  const {
    cancelRichDocumentSnapshot,
    flushRichDocumentSnapshot,
    scheduleRichDocumentSnapshot,
  } = useRichDocumentSnapshotPublisher({
    lastCommittedDocRef,
    onDocChange,
    onTextChange,
    pendingLocalEchoDocRef,
  });

  useEffect(() => {
    focusOwnerRef.current = focusOwner;
  }, [focusOwner]);

  const handleRichChange = useCallback((editor: LexicalEditor, tags: Set<string>) => {
    if (shouldIgnoreMarkdownEditorChange(editor, tags)) {
      return;
    }
    if (!isUserCommittedRichChange(requireUserEditFlag, userEditPendingRef.current, tags)) {
      return;
    }

    if (richChangePolicy === "dirty") {
      userEditPendingRef.current = false;
      onDirtyChange?.();
      scheduleRichDocumentSnapshot(editor);
      return;
    }

    const nextDoc = getLexicalMarkdown(editor);
    const published = publishLexicalDocumentSnapshot({
      lastCommittedDocRef,
      onDocChange,
      onTextChange,
      pendingLocalEchoDocRef,
      userEditPendingRef,
    }, nextDoc);
    if (!published.changed) {
      return;
    }
    const nextSelection = readSourceSelectionFromLexicalSelection(editor, {
      fallback: sourceSelectionRef.current,
      markdown: nextDoc,
    });
    if (nextSelection) {
      sourceSelectionRef.current = nextSelection;
      onSelectionChange?.(nextSelection);
    }
  }, [
    lastCommittedDocRef,
    onDirtyChange,
    onDocChange,
    onSelectionChange,
    onTextChange,
    pendingLocalEchoDocRef,
    requireUserEditFlag,
    richChangePolicy,
    scheduleRichDocumentSnapshot,
  ]);

  const syncSelectionToDocLength = useCallback((docLength: number) => {
    sourceSelectionRef.current = createMarkdownSelection(
      sourceSelectionRef.current.anchor,
      sourceSelectionRef.current.focus,
      docLength,
    );
  }, []);

  return {
    initialDocRef,
    lastCommittedDocRef,
    pendingLocalEchoDocRef,
    canonicalBridgeEchoRef,
    sourceSelectionRef,
    userEditPendingRef,
    focusOwnerRef,
    embeddedFieldFlushRegistry,
    cancelRichDocumentSnapshot,
    flushRichDocumentSnapshot,
    handleRichChange,
    syncSelectionToDocLength,
  };
}

export function LexicalDocumentSyncPlugin({
  doc,
  lastCommittedDocRef,
  pendingLocalEchoDocRef,
  preserveLocalHistory,
}: {
  readonly doc: string;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly preserveLocalHistory: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const pendingLocalEchoDoc = pendingLocalEchoDocRef.current;
    if (doc === lastCommittedDocRef.current) {
      if (pendingLocalEchoDoc === doc) {
        pendingLocalEchoDocRef.current = null;
      }
      return;
    }

    const preservePendingLocalHistory =
      preserveLocalHistory && pendingLocalEchoDoc !== null;
    setLexicalMarkdown(
      editor,
      doc,
      {
        discrete: false,
        tag: preservePendingLocalHistory
          ? [HISTORY_MERGE_TAG, COFLAT_DOCUMENT_SYNC_TAG]
          : COFLAT_DOCUMENT_SYNC_TAG,
      },
    );
    if (!preservePendingLocalHistory) {
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
    pendingLocalEchoDocRef.current = null;
    lastCommittedDocRef.current = doc;
  }, [doc, editor, lastCommittedDocRef, pendingLocalEchoDocRef, preserveLocalHistory]);

  return null;
}

export function LexicalSourceBridgePlugin({
  canonicalBridgeEchoRef,
  doc,
  editorMode,
  flushRichDocumentSnapshot,
  lastCommittedDocRef,
  pendingModeSyncRef,
  pendingLocalEchoDocRef,
  selectionRef,
  userEditPendingRef,
}: {
  readonly canonicalBridgeEchoRef: MutableRefObject<boolean>;
  readonly doc: string;
  readonly editorMode: RevealMode;
  readonly flushRichDocumentSnapshot?: () => string | null;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingModeSyncRef?: MutableRefObject<(() => void) | null>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();
  const appliedModeRef = useRef(editorMode);
  const appliedDocPropRef = useRef(doc);

  useEffect(() => {
    const previousDocProp = appliedDocPropRef.current;
    const docPropChanged = previousDocProp !== doc;
    const pendingLocalEchoDocBeforeFlush = pendingLocalEchoDocRef.current;
    const previousMode = appliedModeRef.current;
    const modeChanged = previousMode !== editorMode;
    if (
      !modeChanged
      && canonicalBridgeEchoRef.current
      && pendingLocalEchoDocBeforeFlush !== null
    ) {
      if (pendingLocalEchoDocBeforeFlush === doc) {
        pendingLocalEchoDocRef.current = null;
        canonicalBridgeEchoRef.current = false;
      }
      appliedDocPropRef.current = doc;
      return;
    }
    if (
      !modeChanged
      && !docPropChanged
      && pendingLocalEchoDocBeforeFlush !== null
    ) {
      if (pendingLocalEchoDocBeforeFlush === doc) {
        pendingLocalEchoDocRef.current = null;
      }
      return;
    }

    if (pendingLocalEchoDocBeforeFlush === null) {
      flushRichDocumentSnapshot?.();
    }
    const pendingLocalEchoDoc = pendingLocalEchoDocRef.current;
    const docChanged = doc !== lastCommittedDocRef.current;
    if (!modeChanged && !docChanged) {
      if (pendingLocalEchoDoc === doc) {
        pendingLocalEchoDocRef.current = null;
      }
      appliedDocPropRef.current = doc;
      return;
    }

    // On a pure mode toggle, `doc` is the canonical source. Re-reading the
    // previous rich state can be lossy for Pandoc-flavored constructs.
    const nextDoc = pendingLocalEchoDoc !== null && modeChanged
      ? pendingLocalEchoDoc
      : doc;
    const nextSelection = createMarkdownSelection(
      selectionRef.current.anchor,
      selectionRef.current.focus,
      nextDoc.length,
    );
    const mergeHistory = pendingLocalEchoDoc !== null || (modeChanged && !docChanged);
    const syncOptions = {
      discrete: false,
      tag: mergeHistory
        ? [HISTORY_MERGE_TAG, COFLAT_DOCUMENT_SYNC_TAG]
        : COFLAT_DOCUMENT_SYNC_TAG,
    };

    selectionRef.current = nextSelection;
    lastCommittedDocRef.current = nextDoc;
    userEditPendingRef.current = false;
    appliedModeRef.current = editorMode;
    appliedDocPropRef.current = doc;
    canonicalBridgeEchoRef.current = false;
    pendingLocalEchoDocRef.current = null;

    let applied = false;
    const applyModeSync = () => {
      if (applied) {
        return;
      }
      applied = true;
      if (pendingModeSyncRef?.current === applyModeSync) {
        pendingModeSyncRef.current = null;
      }
      const pendingLocalEchoDoc = pendingLocalEchoDocRef.current;
      if (
        lastCommittedDocRef.current !== nextDoc ||
        (pendingLocalEchoDoc !== null && pendingLocalEchoDoc !== nextDoc)
      ) {
        return;
      }
      const selectionToApply = createMarkdownSelection(
        selectionRef.current.anchor,
        selectionRef.current.focus,
        nextDoc.length,
      );
      selectionRef.current = selectionToApply;
      if (editorMode === "source") {
        replaceSourceText(editor, nextDoc, selectionToApply, syncOptions);
      } else {
        setLexicalMarkdown(editor, nextDoc, syncOptions);
        selectSourceOffsetsInRichLexicalRoot(
          editor,
          nextDoc,
          selectionToApply.anchor,
          selectionToApply.focus,
          {
            revealRawBlockAtBoundary: false,
            revealRawBlocks: false,
          },
        );
      }
    };
    pendingModeSyncRef?.current?.();
    if (pendingModeSyncRef) {
      pendingModeSyncRef.current = applyModeSync;
    }
    queueMicrotask(applyModeSync);
    return () => {
      if (pendingModeSyncRef?.current === applyModeSync) {
        pendingModeSyncRef.current = null;
      }
    };
  }, [
    canonicalBridgeEchoRef,
    doc,
    editor,
    editorMode,
    flushRichDocumentSnapshot,
    lastCommittedDocRef,
    pendingModeSyncRef,
    pendingLocalEchoDocRef,
    selectionRef,
    userEditPendingRef,
  ]);

  return null;
}
