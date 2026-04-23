import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_LOW,
  type EditorUpdateOptions,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from "lexical";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import {
  applyEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/editor-doc-change";
import type { SurfaceFocusOwner } from "../state/editor-focus";
import { hasCursorRevealActive } from "./cursor-reveal-state";
import { readEmbeddedInlineDomSelection } from "./embedded-selection";
import {
  replaceSourceText,
} from "./document-session-helpers";
import { dispatchSurfaceFocusRequest } from "./editor-focus-plugin";
import {
  consumePendingDestructiveVisibleOffset,
  createMarkdownSelection,
  storeSelection,
} from "./editor-surface-shared";
import { useEmbeddedFieldFlushRegistry } from "./embedded-field-flush-registry";
import {
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import { REVEAL_MODE, type RevealMode } from "./reveal-mode";
import {
  mapVisibleTextOffsetToMarkdown,
  readSourceSelectionFromLexicalSelection,
  scrollSourcePositionIntoView,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-position-plugin";
import {
  getSourceText,
  selectSourceOffsetsInLexicalRoot,
} from "./source-text";
import {
  canReadLiveSelectionFromEditor,
  sameSelection,
  selectionTouchesFencedDiv,
} from "./selection-helpers";
import { useDeferredRichDocumentSync } from "./use-deferred-rich-document-sync";

interface RichMarkdownSnapshot {
  readonly editorState: ReturnType<LexicalEditor["getEditorState"]>;
  readonly markdown: string;
}

interface LexicalEditorHandlePluginProps {
  readonly canonicalBridgeEchoRef?: MutableRefObject<boolean>;
  readonly editorModeRef: MutableRefObject<RevealMode>;
  readonly cancelRichDocumentSnapshot?: () => void;
  readonly focusOwnerRef: MutableRefObject<SurfaceFocusOwner>;
  readonly flushRichDocumentSnapshot?: () => string | null;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingModeSyncRef?: MutableRefObject<(() => void) | null>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly readInactiveRichSelection?: boolean;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly storeSelectionOnNoopChange?: boolean;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}

export function LexicalEditorHandlePlugin({
  canonicalBridgeEchoRef,
  editorModeRef,
  cancelRichDocumentSnapshot,
  focusOwnerRef,
  flushRichDocumentSnapshot,
  lastCommittedDocRef,
  onEditorReady,
  onDocChange,
  onSelectionChange,
  onTextChange,
  pendingModeSyncRef,
  pendingLocalEchoDocRef,
  readInactiveRichSelection = false,
  selectionRef,
  storeSelectionOnNoopChange = false,
  userEditPendingRef,
}: LexicalEditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();
  const embeddedFieldFlushRegistry = useEmbeddedFieldFlushRegistry();
  const selectionSnapshotFreshRef = useRef(false);
  const richMarkdownSnapshotRef = useRef<RichMarkdownSnapshot | null>(null);
  const richSelectionDomInsertFailedRef = useRef(false);
  const suppressRichSelectionPublishRef = useRef(false);
  const canonicalFallbackSelectionRef = useRef<MarkdownEditorSelection | null>(null);
  const cacheRichDocumentSnapshot = useCallback((markdown: string) => {
    if (editorModeRef.current === "source") {
      return;
    }
    richMarkdownSnapshotRef.current = {
      editorState: editor.getEditorState(),
      markdown,
    };
  }, [editor, editorModeRef]);
  const {
    applyDeferredRichDocumentSync,
    clearDeferredRichDocumentSync,
    pendingDocRef: deferredRichSyncDocRef,
    scheduleDeferredRichDocumentSync,
  } = useDeferredRichDocumentSync({
    cacheRichDocumentSnapshot,
    canonicalFallbackSelectionRef,
    editor,
    editorModeRef,
    richSelectionDomInsertFailedRef,
    selectionRef,
    selectionSnapshotFreshRef,
  });

  useEffect(() => {
    const publishSelection = () => {
      if (
        suppressRichSelectionPublishRef.current
        || editorModeRef.current === "source"
        || deferredRichSyncDocRef.current !== null
        || richSelectionDomInsertFailedRef.current
        || (!readInactiveRichSelection && !canReadLiveSelectionFromEditor(editor))
      ) {
        return;
      }

      const currentDoc = pendingLocalEchoDocRef.current ?? lastCommittedDocRef.current;
      const nextSelection = readEmbeddedInlineDomSelection(currentDoc)
        ?? readSourceSelectionFromLexicalSelection(editor, {
          fallback: selectionRef.current,
          markdown: currentDoc,
        });
      if (!nextSelection || sameSelection(selectionRef.current, nextSelection)) {
        return;
      }

      selectionRef.current = nextSelection;
      selectionSnapshotFreshRef.current = true;
      onSelectionChange?.(nextSelection);
    };

    const unregisterSelectionCommand = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        publishSelection();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const unregisterUpdateListener = editor.registerUpdateListener(() => {
      if (selectionSnapshotFreshRef.current) {
        selectionSnapshotFreshRef.current = false;
        return;
      }
      publishSelection();
    });
    return () => {
      unregisterSelectionCommand();
      unregisterUpdateListener();
    };
  }, [
    deferredRichSyncDocRef,
    editor,
    editorModeRef,
    lastCommittedDocRef,
    onSelectionChange,
    pendingLocalEchoDocRef,
    readInactiveRichSelection,
    selectionRef,
  ]);

  useEffect(() => {
    if (!onEditorReady) {
      return;
    }

    const readRichDocumentSnapshot = () => {
      const editorState = editor.getEditorState();
      const cached = richMarkdownSnapshotRef.current;
      if (cached?.editorState === editorState) {
        return cached.markdown;
      }

      const markdown = getLexicalMarkdown(editor);
      richMarkdownSnapshotRef.current = {
        editorState,
        markdown,
      };
      return markdown;
    };

    const readDocumentSnapshot = () =>
      editorModeRef.current === "source"
        ? getSourceText(editor)
        : deferredRichSyncDocRef.current
          ?? pendingLocalEchoDocRef.current
          ?? readRichDocumentSnapshot();
    const readSelectionDocumentSnapshot = () =>
      editorModeRef.current === "source"
        ? getSourceText(editor)
        : deferredRichSyncDocRef.current
          ?? pendingLocalEchoDocRef.current
          ?? lastCommittedDocRef.current;

    const stageDocumentSnapshot = (nextDoc: string) => {
      if (nextDoc !== lastCommittedDocRef.current) {
        pendingLocalEchoDocRef.current = nextDoc;
      }
      userEditPendingRef.current = false;
    };

    const publishDocumentSnapshot = (nextDoc: string) => {
      cancelRichDocumentSnapshot?.();
      const changes = createMinimalEditorDocumentChanges(
        lastCommittedDocRef.current,
        nextDoc,
      );
      pendingLocalEchoDocRef.current = nextDoc;
      lastCommittedDocRef.current = nextDoc;
      userEditPendingRef.current = false;
      onTextChange?.(nextDoc);
      if (changes.length > 0) {
        onDocChange?.(changes);
      }
    };

    const readSelectionSnapshot = () => {
      const currentDoc = readDocumentSnapshot();
      if (editorModeRef.current === "source") {
        return selectionRef.current;
      }
      if (deferredRichSyncDocRef.current !== null || richSelectionDomInsertFailedRef.current) {
        return canonicalFallbackSelectionRef.current ?? selectionRef.current;
      }

      const pendingDestructiveVisibleOffset = consumePendingDestructiveVisibleOffset(editor);
      if (pendingDestructiveVisibleOffset !== null) {
        const sourceOffset = mapVisibleTextOffsetToMarkdown(
          currentDoc,
          pendingDestructiveVisibleOffset,
        ) ?? pendingDestructiveVisibleOffset;
        const nextSelection = createMarkdownSelection(sourceOffset, sourceOffset, currentDoc.length);
        selectionRef.current = nextSelection;
        selectSourceOffsetsInRichLexicalRoot(
          editor,
          currentDoc,
          nextSelection.anchor,
          nextSelection.focus,
          {
            revealRawBlockAtBoundary: false,
            revealRawBlocks: false,
          },
        );
        return nextSelection;
      }

      const embeddedSelection = readEmbeddedInlineDomSelection(currentDoc);
      if (embeddedSelection) {
        selectionRef.current = embeddedSelection;
        return embeddedSelection;
      }

      if (!readInactiveRichSelection && !canReadLiveSelectionFromEditor(editor)) {
        return selectionRef.current;
      }

      const liveSelection = readSourceSelectionFromLexicalSelection(editor, {
        fallback: selectionRef.current,
        markdown: currentDoc,
      });
      if (!liveSelection) {
        return selectionRef.current;
      }

      selectionRef.current = liveSelection;
      selectionSnapshotFreshRef.current = true;
      return liveSelection;
    };

    const refreshRichSelectionSnapshot = (currentDoc: string) => {
      if (editorModeRef.current === "source") {
        return;
      }
      if (!readInactiveRichSelection && !canReadLiveSelectionFromEditor(editor)) {
        return;
      }
      const liveSelection = readSourceSelectionFromLexicalSelection(editor, {
        fallback: selectionRef.current,
        markdown: currentDoc,
      });
      if (!liveSelection) {
        return;
      }
      selectionRef.current = liveSelection;
      onSelectionChange?.(liveSelection);
    };

    const flushPendingEdits = () => {
      embeddedFieldFlushRegistry?.flush();
      if (deferredRichSyncDocRef.current !== null) {
        const nextDoc = deferredRichSyncDocRef.current;
        applyDeferredRichDocumentSync();
        return nextDoc;
      }
      const flushedDoc = flushRichDocumentSnapshot?.() ?? null;
      if (flushedDoc !== null) {
        cacheRichDocumentSnapshot(flushedDoc);
      }
      return flushedDoc;
    };

    const readFreshDocument = () => {
      pendingModeSyncRef?.current?.();
      if (editorModeRef.current !== "source" && deferredRichSyncDocRef.current !== null) {
        const nextDoc = deferredRichSyncDocRef.current;
        stageDocumentSnapshot(nextDoc);
        if (selectionSnapshotFreshRef.current) {
          selectionSnapshotFreshRef.current = false;
        }
        return nextDoc;
      }
      const preFlushRevealDoc = editorModeRef.current === "source" || !hasCursorRevealActive(editor)
        ? null
        : readDocumentSnapshot();
      const preFlushRevealSelection = preFlushRevealDoc === null
        ? null
        : readSourceSelectionFromLexicalSelection(editor, {
            fallback: selectionRef.current,
            markdown: preFlushRevealDoc,
          });
      const flushedDoc = flushPendingEdits();
      const nextDoc = flushedDoc ?? readDocumentSnapshot();
      stageDocumentSnapshot(nextDoc);
      if (preFlushRevealSelection) {
        const nextSelection = createMarkdownSelection(
          preFlushRevealSelection.anchor,
          preFlushRevealSelection.focus,
          nextDoc.length,
        );
        selectionRef.current = nextSelection;
        onSelectionChange?.(nextSelection);
        selectionSnapshotFreshRef.current = true;
      } else if (selectionSnapshotFreshRef.current) {
        selectionSnapshotFreshRef.current = false;
      } else {
        refreshRichSelectionSnapshot(nextDoc);
      }
      return nextDoc;
    };

    onEditorReady({
      applyChanges: (changes) => {
        pendingModeSyncRef?.current?.();
        if (changes.length === 0) {
          return;
        }

        const currentDoc = readFreshDocument();
        const nextDoc = applyEditorDocumentChanges(currentDoc, changes);
        if (nextDoc === currentDoc) {
          if (storeSelectionOnNoopChange) {
            storeSelection(
              selectionRef,
              currentDoc.length,
              onSelectionChange,
              selectionRef.current.anchor,
              selectionRef.current.focus,
            );
          }
          return;
        }

        if (editorModeRef.current === "source") {
          const nextSelection = storeSelection(
            selectionRef,
            nextDoc.length,
            onSelectionChange,
            selectionRef.current.anchor,
            selectionRef.current.focus,
          );
          replaceSourceText(editor, nextDoc, nextSelection);
          return;
        }

        userEditPendingRef.current = true;
        storeSelection(
          selectionRef,
          nextDoc.length,
          onSelectionChange,
          selectionRef.current.anchor,
          selectionRef.current.focus,
        );
        publishDocumentSnapshot(nextDoc);
        setLexicalMarkdown(editor, nextDoc);
      },
      focus: () => {
        pendingModeSyncRef?.current?.();
        applyDeferredRichDocumentSync();
        if (editorModeRef.current !== "source") {
          scrollSourcePositionIntoView(editor, editor.getRootElement(), selectionRef.current.from);
        }
        dispatchSurfaceFocusRequest(editor, { owner: focusOwnerRef.current });
      },
      flushPendingEdits,
      getDoc: readFreshDocument,
      getSelection: readSelectionSnapshot,
      peekDoc: readDocumentSnapshot,
      peekSelection: readSelectionSnapshot,
      insertText: (text) => {
        pendingModeSyncRef?.current?.();
        const currentDoc = editorModeRef.current !== "source" && richSelectionDomInsertFailedRef.current
          ? readSelectionDocumentSnapshot()
          : readFreshDocument();
        const baseSelection = editorModeRef.current !== "source" && richSelectionDomInsertFailedRef.current
          ? canonicalFallbackSelectionRef.current ?? selectionRef.current
          : selectionRef.current;
        const selection = createMarkdownSelection(
          baseSelection.anchor,
          baseSelection.focus,
          currentDoc.length,
        );
        const nextDoc = [
          currentDoc.slice(0, selection.from),
          text,
          currentDoc.slice(selection.to),
        ].join("");
        const nextOffset = selection.from + text.length;

        if (nextDoc === currentDoc) {
          storeSelection(selectionRef, currentDoc.length, onSelectionChange, nextOffset);
          return;
        }

        if (editorModeRef.current === "source") {
          const nextSelection = storeSelection(
            selectionRef,
            nextDoc.length,
            onSelectionChange,
            nextOffset,
          );
          replaceSourceText(editor, nextDoc, nextSelection);
          return;
        }

        const nextSelection = storeSelection(
          selectionRef,
          nextDoc.length,
          onSelectionChange,
          nextOffset,
        );
        canonicalFallbackSelectionRef.current = nextSelection;
        if (canonicalBridgeEchoRef) {
          canonicalBridgeEchoRef.current = true;
        }
        publishDocumentSnapshot(nextDoc);
        selectionSnapshotFreshRef.current = true;
        richSelectionDomInsertFailedRef.current = true;
        scheduleDeferredRichDocumentSync(nextDoc, currentDoc);
      },
      setDoc: (doc) => {
        pendingModeSyncRef?.current?.();
        const currentDoc = readFreshDocument();
        const nextSelection = storeSelection(
          selectionRef,
          doc.length,
          onSelectionChange,
          selectionRef.current.anchor,
          selectionRef.current.focus,
        );
        if (doc === currentDoc) {
          return;
        }

        if (editorModeRef.current === "source") {
          replaceSourceText(editor, doc, nextSelection);
          return;
        }

        userEditPendingRef.current = true;
        publishDocumentSnapshot(doc);
        setLexicalMarkdown(editor, doc);
      },
      setSelection: (anchor, focus = anchor, options) => {
        pendingModeSyncRef?.current?.();
        if (editorModeRef.current === "source") {
          flushPendingEdits();
        } else {
          applyDeferredRichDocumentSync();
        }
        const currentDoc = readSelectionDocumentSnapshot();
        const nextSelection = storeSelection(
          selectionRef,
          currentDoc.length,
          onSelectionChange,
          anchor,
          focus,
        );

        if (editorModeRef.current === "source") {
          const tags: EditorUpdateOptions["tag"] = options?.skipScrollIntoView
            ? [SKIP_SCROLL_INTO_VIEW_TAG]
            : undefined;
          editor.update(() => {
            selectSourceOffsetsInLexicalRoot(nextSelection.anchor, nextSelection.focus);
          }, { discrete: true, tag: tags });
        } else {
          suppressRichSelectionPublishRef.current = true;
          const moved = selectSourceOffsetsInRichLexicalRoot(
            editor,
            currentDoc,
            nextSelection.anchor,
            nextSelection.focus,
          );
          if (!moved || selectionTouchesFencedDiv(currentDoc, nextSelection)) {
            selectionSnapshotFreshRef.current = false;
            richSelectionDomInsertFailedRef.current = true;
            canonicalFallbackSelectionRef.current = nextSelection;
            scrollSourcePositionIntoView(editor, editor.getRootElement(), nextSelection.from);
          } else if (nextSelection.anchor === nextSelection.focus) {
            selectionSnapshotFreshRef.current = true;
            richSelectionDomInsertFailedRef.current = false;
            canonicalFallbackSelectionRef.current = null;
          } else {
            const liveSelection = readSourceSelectionFromLexicalSelection(editor, {
              fallback: undefined,
              markdown: currentDoc,
            });
            const selectionMatches = liveSelection !== null && sameSelection(liveSelection, nextSelection);
            selectionSnapshotFreshRef.current = selectionMatches;
            richSelectionDomInsertFailedRef.current = !selectionMatches;
            canonicalFallbackSelectionRef.current = selectionMatches ? null : nextSelection;
          }
          queueMicrotask(() => {
            suppressRichSelectionPublishRef.current = false;
          });
        }
        dispatchSurfaceFocusRequest(editor, { owner: focusOwnerRef.current });
      },
    }, editor);

    return undefined;
  }, [
    applyDeferredRichDocumentSync,
    cacheRichDocumentSnapshot,
    clearDeferredRichDocumentSync,
    editor,
    editorModeRef,
    embeddedFieldFlushRegistry,
    canonicalBridgeEchoRef,
    cancelRichDocumentSnapshot,
    focusOwnerRef,
    flushRichDocumentSnapshot,
    lastCommittedDocRef,
    onEditorReady,
    onDocChange,
    onSelectionChange,
    onTextChange,
    pendingModeSyncRef,
    pendingLocalEchoDocRef,
    readInactiveRichSelection,
    selectionRef,
    storeSelectionOnNoopChange,
    userEditPendingRef,
  ]);

  return null;
}

interface RichLexicalEditorHandlePluginProps {
  readonly canonicalBridgeEchoRef?: MutableRefObject<boolean>;
  readonly cancelRichDocumentSnapshot?: () => void;
  readonly focusOwner: SurfaceFocusOwner;
  readonly flushRichDocumentSnapshot?: () => string | null;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}

export function RichLexicalEditorHandlePlugin({
  canonicalBridgeEchoRef,
  cancelRichDocumentSnapshot,
  focusOwner,
  flushRichDocumentSnapshot,
  lastCommittedDocRef,
  onEditorReady,
  onDocChange,
  onSelectionChange,
  onTextChange,
  pendingLocalEchoDocRef,
  selectionRef,
  userEditPendingRef,
}: RichLexicalEditorHandlePluginProps) {
  const editorModeRef = useRef<RevealMode>(REVEAL_MODE.LEXICAL);
  const focusOwnerRef = useRef<SurfaceFocusOwner>(focusOwner);
  focusOwnerRef.current = focusOwner;

  return (
    <LexicalEditorHandlePlugin
      cancelRichDocumentSnapshot={cancelRichDocumentSnapshot}
      canonicalBridgeEchoRef={canonicalBridgeEchoRef}
      editorModeRef={editorModeRef}
      focusOwnerRef={focusOwnerRef}
      flushRichDocumentSnapshot={flushRichDocumentSnapshot}
      lastCommittedDocRef={lastCommittedDocRef}
      onEditorReady={onEditorReady}
      onDocChange={onDocChange}
      onSelectionChange={onSelectionChange}
      onTextChange={onTextChange}
      pendingLocalEchoDocRef={pendingLocalEchoDocRef}
      readInactiveRichSelection
      selectionRef={selectionRef}
      storeSelectionOnNoopChange
      userEditPendingRef={userEditPendingRef}
    />
  );
}
