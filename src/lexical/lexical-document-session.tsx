import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  CLEAR_HISTORY_COMMAND,
  type EditorUpdateOptions,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  PASTE_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from "lexical";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef } from "react";
import {
  applyEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
  type EditorDocumentChange,
} from "../lib/editor-doc-change";
import type { SurfaceFocusOwner } from "../state/editor-focus";
import { getActiveEditor } from "./active-editor-tracker";
import { hasCursorRevealActive } from "./cursor-reveal-state";
import { readVisibleTextDomSelection } from "./dom-selection";
import { dispatchSurfaceFocusRequest } from "./editor-focus-plugin";
import {
  consumePendingDestructiveVisibleOffset,
  createMarkdownSelection,
  storeSelection,
} from "./editor-surface-shared";
import {
  createEmbeddedFieldFlushRegistry,
  useEmbeddedFieldFlushRegistry,
} from "./embedded-field-flush-registry";
import {
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import { collectSourceBlockRanges } from "./markdown/block-scanner";
import { parseStructuredFencedDivRaw } from "./markdown/block-syntax";
import type { MarkdownEditorHandle, MarkdownEditorSelection } from "./markdown-editor-types";
import { REVEAL_MODE, type RevealMode } from "./reveal-mode";
import { readSourceFrom, readSourceTo } from "./source-position-contract";
import {
  mapVisibleTextOffsetToMarkdown,
  readSourceSelectionFromLexicalSelection,
  scrollSourcePositionIntoView,
  selectSourceOffsetsInRichLexicalRoot,
} from "./source-position-plugin";
import {
  mapVisibleTextSelectionToMarkdown,
} from "./source-selection";
import {
  getSourceText,
  selectSourceOffsetsInLexicalRoot,
  writeSourceTextToLexicalRoot,
} from "./source-text";
import { fencedDivTitleMarkdownOffset } from "./structure-source-offsets";
import {
  COFLAT_DOCUMENT_SYNC_TAG,
  COFLAT_FORMAT_COMMIT_TAG,
  COFLAT_INCREMENTAL_DOC_CHANGE_TAG,
  COFLAT_NESTED_EDIT_TAG,
  COFLAT_REVEAL_COMMIT_TAG,
  COFLAT_REVEAL_UI_TAG,
} from "./update-tags";
import { useDeferredRichDocumentSync } from "./use-deferred-rich-document-sync";
import {
  useRichDocumentSnapshotPublisher,
} from "./use-rich-document-snapshot-publisher";

interface RichMarkdownSnapshot {
  readonly editorState: ReturnType<LexicalEditor["getEditorState"]>;
  readonly markdown: string;
}

export function sameSelection(
  left: MarkdownEditorSelection,
  right: MarkdownEditorSelection,
): boolean {
  return (
    left.anchor === right.anchor
    && left.focus === right.focus
    && left.from === right.from
    && left.to === right.to
  );
}

export function canReadLiveSelectionFromEditor(editor: LexicalEditor): boolean {
  const activeEditor = getActiveEditor();
  return activeEditor === null || activeEditor === editor;
}

export function readEmbeddedInlineDomSelection(doc: string): MarkdownEditorSelection | null {
  const selection = document.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode) {
    return null;
  }
  const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
  const titleShell = anchorElement?.closest<HTMLElement>(".cf-lexical-block-title");
  const root = titleShell?.querySelector<HTMLElement>("[contenteditable='true']");
  const rawBlock = titleShell?.closest<HTMLElement>("[data-coflat-raw-block='true']");
  if (!root || !rawBlock || !root.contains(anchorNode) || !root.contains(focusNode)) {
    return null;
  }
  const selectedText = selection.toString();
  if (selectedText) {
    const boldNeedle = `**${selectedText}**`;
    const boldFrom = doc.indexOf(boldNeedle);
    if (boldFrom >= 0 && doc.indexOf(boldNeedle, boldFrom + boldNeedle.length) < 0) {
      return createMarkdownSelection(
        boldFrom + 2,
        boldFrom + 2 + selectedText.length,
        doc.length,
      );
    }
  }
  const sourceFrom = readSourceFrom(rawBlock);
  const sourceTo = readSourceTo(rawBlock);
  const visibleSelection = readVisibleTextDomSelection(root);
  if (sourceFrom === null || sourceTo === null || !visibleSelection) {
    return null;
  }
  const raw = doc.slice(sourceFrom, sourceTo);
  const parsed = parseStructuredFencedDivRaw(raw);
  const titleOffset = fencedDivTitleMarkdownOffset(raw, parsed);
  if (titleOffset === null || !parsed.titleMarkdown) {
    return null;
  }
  const mapped = mapVisibleTextSelectionToMarkdown(parsed.titleMarkdown, {
    anchor: visibleSelection.anchor,
    focus: visibleSelection.focus,
    from: visibleSelection.from,
    to: visibleSelection.to,
  });
  if (!mapped) {
    return null;
  }
  return createMarkdownSelection(
    sourceFrom + titleOffset + mapped.anchor,
    sourceFrom + titleOffset + mapped.focus,
    doc.length,
  );
}

export function replaceSourceText(
  editor: LexicalEditor,
  text: string,
  selection: MarkdownEditorSelection,
  options?: Pick<EditorUpdateOptions, "tag">,
): void {
  editor.update(() => {
    writeSourceTextToLexicalRoot(text);
    selectSourceOffsetsInLexicalRoot(selection.anchor, selection.focus);
  }, {
    discrete: true,
    tag: options?.tag,
  });
}

export function readEditorDocument(editor: LexicalEditor, editorMode: RevealMode): string {
  return editorMode === "source"
    ? getSourceText(editor)
    : getLexicalMarkdown(editor);
}

export function shouldIgnoreMarkdownEditorChange(
  editor: LexicalEditor,
  tags: Set<string>,
): boolean {
  if (tags.has(COFLAT_DOCUMENT_SYNC_TAG)) {
    return true;
  }
  if (tags.has(COFLAT_INCREMENTAL_DOC_CHANGE_TAG)) {
    return true;
  }
  if (tags.has(COFLAT_REVEAL_UI_TAG) && !tags.has(COFLAT_REVEAL_COMMIT_TAG)) {
    return true;
  }
  return !tags.has(COFLAT_REVEAL_COMMIT_TAG) && hasCursorRevealActive(editor);
}

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

function selectionTouchesFencedDiv(
  doc: string,
  selection: MarkdownEditorSelection,
): boolean {
  return collectSourceBlockRanges(doc).some((range) =>
    range.variant === "fenced-div" &&
    selection.from >= range.from &&
    selection.to <= range.to
  );
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
    const changes = createMinimalEditorDocumentChanges(
      lastCommittedDocRef.current,
      nextDoc,
    );
    if (changes.length === 0) {
      userEditPendingRef.current = false;
      return;
    }

    userEditPendingRef.current = false;
    const nextSelection = readSourceSelectionFromLexicalSelection(editor, {
      fallback: sourceSelectionRef.current,
      markdown: nextDoc,
    });
    if (nextSelection) {
      sourceSelectionRef.current = nextSelection;
      onSelectionChange?.(nextSelection);
    }
    pendingLocalEchoDocRef.current = nextDoc;
    lastCommittedDocRef.current = nextDoc;
    onTextChange?.(nextDoc);
    onDocChange?.(changes);
  }, [
    onDirtyChange,
    onDocChange,
    onSelectionChange,
    onTextChange,
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
