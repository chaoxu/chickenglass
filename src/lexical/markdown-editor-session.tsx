import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  type EditorState,
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
import { measureSync } from "../app/perf";
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

const RICH_DOCUMENT_SNAPSHOT_DEBOUNCE_MS = 200;

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

export interface MarkdownEditorSessionController {
  readonly initialDocRef: MutableRefObject<string>;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly sourceSelectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
  readonly focusOwnerRef: MutableRefObject<SurfaceFocusOwner>;
  readonly embeddedFieldFlushRegistry: ReturnType<typeof createEmbeddedFieldFlushRegistry>;
  readonly flushRichDocumentSnapshot: () => string | null;
  readonly handleRichChange: (editor: LexicalEditor, tags: Set<string>) => void;
  readonly syncSelectionToDocLength: (docLength: number) => void;
}

type RichChangePolicy = "markdown" | "dirty";

interface RichMarkdownSnapshot {
  readonly editorState: EditorState;
  readonly markdown: string;
}

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

export function useMarkdownEditorSessionController({
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
}): MarkdownEditorSessionController {
  const initialDocRef = useRef(doc);
  const lastCommittedDocRef = useRef(doc);
  const pendingLocalEchoDocRef = useRef<string | null>(null);
  const sourceSelectionRef = useRef<MarkdownEditorSelection>(createMarkdownSelection(0));
  const userEditPendingRef = useRef(false);
  const focusOwnerRef = useRef(focusOwner);
  const richSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const richSnapshotEditorRef = useRef<LexicalEditor | null>(null);
  const richMarkdownSnapshotRef = useRef<RichMarkdownSnapshot | null>(null);
  const embeddedFieldFlushRegistry = useMemo(createEmbeddedFieldFlushRegistry, []);

  useEffect(() => {
    focusOwnerRef.current = focusOwner;
  }, [focusOwner]);

  const clearRichSnapshotTimer = useCallback(() => {
    const timer = richSnapshotTimerRef.current;
    if (timer !== null) {
      clearTimeout(timer);
      richSnapshotTimerRef.current = null;
    }
    richSnapshotEditorRef.current = null;
  }, []);

  const readRichDocumentSnapshot = useCallback((editor: LexicalEditor) => {
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
  }, []);

  const publishRichDocumentSnapshot = useCallback((editor: LexicalEditor) => {
    const nextDoc = measureSync(
      "lexical.publishRichDocumentSnapshot",
      () => readRichDocumentSnapshot(editor),
      { category: "lexical" },
    );
    const changes = createMinimalEditorDocumentChanges(
      lastCommittedDocRef.current,
      nextDoc,
    );
    if (changes.length === 0) {
      return nextDoc;
    }

    pendingLocalEchoDocRef.current = nextDoc;
    lastCommittedDocRef.current = nextDoc;
    onTextChange?.(nextDoc);
    onDocChange?.(changes);
    return nextDoc;
  }, [
    lastCommittedDocRef,
    onDocChange,
    onTextChange,
    pendingLocalEchoDocRef,
    readRichDocumentSnapshot,
  ]);

  const scheduleRichDocumentSnapshot = useCallback((editor: LexicalEditor) => {
    const timer = richSnapshotTimerRef.current;
    if (timer !== null) {
      clearTimeout(timer);
    }
    richSnapshotEditorRef.current = editor;
    richSnapshotTimerRef.current = setTimeout(() => {
      richSnapshotTimerRef.current = null;
      richSnapshotEditorRef.current = null;
      publishRichDocumentSnapshot(editor);
    }, RICH_DOCUMENT_SNAPSHOT_DEBOUNCE_MS);
  }, [publishRichDocumentSnapshot]);

  const flushRichDocumentSnapshot = useCallback(() => {
    const editor = richSnapshotEditorRef.current;
    if (!editor) return null;
    clearRichSnapshotTimer();
    return measureSync(
      "lexical.flushRichDocumentSnapshot",
      () => publishRichDocumentSnapshot(editor),
      { category: "lexical" },
    );
  }, [clearRichSnapshotTimer, publishRichDocumentSnapshot]);

  useEffect(() => () => {
    flushRichDocumentSnapshot();
  }, [flushRichDocumentSnapshot]);

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
    sourceSelectionRef,
    userEditPendingRef,
    focusOwnerRef,
    embeddedFieldFlushRegistry,
    flushRichDocumentSnapshot,
    handleRichChange,
    syncSelectionToDocLength,
  };
}

export function MarkdownSyncPlugin({
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

export function MarkdownModeSyncPlugin({
  doc,
  editorMode,
  flushRichDocumentSnapshot,
  lastCommittedDocRef,
  pendingLocalEchoDocRef,
  selectionRef,
  userEditPendingRef,
}: {
  readonly doc: string;
  readonly editorMode: RevealMode;
  readonly flushRichDocumentSnapshot?: () => string | null;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();
  const appliedModeRef = useRef(editorMode);

  useEffect(() => {
    flushRichDocumentSnapshot?.();
    const pendingLocalEchoDoc = pendingLocalEchoDocRef.current;
    const previousMode = appliedModeRef.current;
    const modeChanged = previousMode !== editorMode;
    const docChanged = doc !== lastCommittedDocRef.current;
    if (!modeChanged && !docChanged) {
      if (pendingLocalEchoDoc === doc) {
        pendingLocalEchoDocRef.current = null;
      }
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
      tag: mergeHistory
        ? [HISTORY_MERGE_TAG, COFLAT_DOCUMENT_SYNC_TAG]
        : COFLAT_DOCUMENT_SYNC_TAG,
    };

    selectionRef.current = nextSelection;
    lastCommittedDocRef.current = nextDoc;
    userEditPendingRef.current = false;
    appliedModeRef.current = editorMode;
    pendingLocalEchoDocRef.current = null;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
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
    });
    return () => {
      cancelled = true;
    };
  }, [
    doc,
    editor,
    editorMode,
    flushRichDocumentSnapshot,
    lastCommittedDocRef,
    pendingLocalEchoDocRef,
    selectionRef,
    userEditPendingRef,
  ]);

  return null;
}

interface MarkdownEditorHandlePluginProps {
  readonly editorModeRef: MutableRefObject<RevealMode>;
  readonly focusOwnerRef: MutableRefObject<SurfaceFocusOwner>;
  readonly flushRichDocumentSnapshot?: () => string | null;
  readonly lastCommittedDocRef: MutableRefObject<string>;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onDocChange?: (changes: readonly EditorDocumentChange[]) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly onTextChange?: (text: string) => void;
  readonly pendingLocalEchoDocRef: MutableRefObject<string | null>;
  readonly readInactiveRichSelection?: boolean;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly storeSelectionOnNoopChange?: boolean;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}

export function MarkdownEditorHandlePlugin({
  editorModeRef,
  focusOwnerRef,
  flushRichDocumentSnapshot,
  lastCommittedDocRef,
  onEditorReady,
  onDocChange,
  onSelectionChange,
  onTextChange,
  pendingLocalEchoDocRef,
  readInactiveRichSelection = false,
  selectionRef,
  storeSelectionOnNoopChange = false,
  userEditPendingRef,
}: MarkdownEditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();
  const embeddedFieldFlushRegistry = useEmbeddedFieldFlushRegistry();
  const selectionSnapshotFreshRef = useRef(false);
  const richMarkdownSnapshotRef = useRef<RichMarkdownSnapshot | null>(null);

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

    const cacheRichDocumentSnapshot = (markdown: string) => {
      if (editorModeRef.current === "source") {
        return;
      }
      richMarkdownSnapshotRef.current = {
        editorState: editor.getEditorState(),
        markdown,
      };
    };

    const readDocumentSnapshot = () =>
      editorModeRef.current === "source"
        ? getSourceText(editor)
        : readRichDocumentSnapshot();
    const readSelectionDocumentSnapshot = () =>
      editorModeRef.current === "source"
        ? getSourceText(editor)
        : pendingLocalEchoDocRef.current ?? lastCommittedDocRef.current;

    const stageDocumentSnapshot = (nextDoc: string) => {
      if (nextDoc !== lastCommittedDocRef.current) {
        pendingLocalEchoDocRef.current = nextDoc;
      }
      userEditPendingRef.current = false;
    };

    const publishDocumentSnapshot = (nextDoc: string) => {
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
      const flushedDoc = flushRichDocumentSnapshot?.() ?? null;
      if (flushedDoc !== null) {
        cacheRichDocumentSnapshot(flushedDoc);
      }
      return flushedDoc;
    };

    const readFreshDocument = () => {
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

    const insertTextIntoRichSelection = (
      currentDoc: string,
      text: string,
    ): { readonly nextDoc: string; readonly nextSelection: MarkdownEditorSelection } | null => {
      const desiredSelection = createMarkdownSelection(
        selectionRef.current.anchor,
        selectionRef.current.focus,
        currentDoc.length,
      );
      const moved = selectSourceOffsetsInRichLexicalRoot(
        editor,
        currentDoc,
        desiredSelection.anchor,
        desiredSelection.focus,
      );
      if (!moved) {
        return null;
      }

      const actualSelection = readSourceSelectionFromLexicalSelection(editor, {
        fallback: desiredSelection,
        markdown: currentDoc,
      }) ?? desiredSelection;
      let inserted = false;
      editor.update(() => {
        const lexicalSelection = $getSelection();
        if (!$isRangeSelection(lexicalSelection)) {
          return;
        }
        lexicalSelection.insertText(text);
        inserted = true;
      }, { discrete: true, tag: SKIP_SCROLL_INTO_VIEW_TAG });
      if (!inserted) {
        return null;
      }

      const nextDoc = [
        currentDoc.slice(0, actualSelection.from),
        text,
        currentDoc.slice(actualSelection.to),
      ].join("");
      const nextOffset = actualSelection.from + text.length;
      return {
        nextDoc,
        nextSelection: createMarkdownSelection(nextOffset, nextOffset, nextDoc.length),
      };
    };

    const insertTextIntoTrackedRichSelection = (
      currentDoc: string,
      text: string,
    ): { readonly nextDoc: string; readonly nextSelection: MarkdownEditorSelection } | null => {
      const trackedSelection = createMarkdownSelection(
        selectionRef.current.anchor,
        selectionRef.current.focus,
        currentDoc.length,
      );
      let inserted = false;
      editor.update(() => {
        const lexicalSelection = $getSelection();
        if (!$isRangeSelection(lexicalSelection)) {
          return;
        }
        lexicalSelection.insertText(text);
        inserted = true;
      }, { discrete: true, tag: SKIP_SCROLL_INTO_VIEW_TAG });
      if (!inserted) {
        return null;
      }

      const nextDoc = [
        currentDoc.slice(0, trackedSelection.from),
        text,
        currentDoc.slice(trackedSelection.to),
      ].join("");
      const nextOffset = trackedSelection.from + text.length;
      return {
        nextDoc,
        nextSelection: createMarkdownSelection(nextOffset, nextOffset, nextDoc.length),
      };
    };

    onEditorReady({
      applyChanges: (changes) => {
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
        const richTrackedDoc = editorModeRef.current === "source" || !selectionSnapshotFreshRef.current
          ? null
          : readSelectionDocumentSnapshot();
        const currentDoc = richTrackedDoc ?? readFreshDocument();
        const selection = createMarkdownSelection(
          selectionRef.current.anchor,
          selectionRef.current.focus,
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

        if (richTrackedDoc !== null) {
          const trackedInsert = insertTextIntoTrackedRichSelection(richTrackedDoc, text);
          if (trackedInsert) {
            selectionRef.current = trackedInsert.nextSelection;
            selectionSnapshotFreshRef.current = true;
            onSelectionChange?.(trackedInsert.nextSelection);
            publishDocumentSnapshot(trackedInsert.nextDoc);
            cacheRichDocumentSnapshot(trackedInsert.nextDoc);
            return;
          }
        }

        const richInsert = insertTextIntoRichSelection(currentDoc, text);
        if (richInsert) {
          selectionRef.current = richInsert.nextSelection;
          selectionSnapshotFreshRef.current = true;
          onSelectionChange?.(richInsert.nextSelection);
          publishDocumentSnapshot(richInsert.nextDoc);
          cacheRichDocumentSnapshot(richInsert.nextDoc);
          return;
        }

        storeSelection(
          selectionRef,
          nextDoc.length,
          onSelectionChange,
          nextOffset,
        );
        userEditPendingRef.current = true;
        publishDocumentSnapshot(nextDoc);
        setLexicalMarkdown(editor, nextDoc);
      },
      setDoc: (doc) => {
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
        flushPendingEdits();
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
          if (!moved) {
            selectionSnapshotFreshRef.current = false;
            scrollSourcePositionIntoView(editor, editor.getRootElement(), nextSelection.from);
          } else {
            selectionSnapshotFreshRef.current = true;
          }
        }
        dispatchSurfaceFocusRequest(editor, { owner: focusOwnerRef.current });
      },
    }, editor);
  }, [
    editor,
    editorModeRef,
    embeddedFieldFlushRegistry,
    focusOwnerRef,
    flushRichDocumentSnapshot,
    lastCommittedDocRef,
    onEditorReady,
    onDocChange,
    onSelectionChange,
    onTextChange,
    pendingLocalEchoDocRef,
    readInactiveRichSelection,
    selectionRef,
    storeSelectionOnNoopChange,
    userEditPendingRef,
  ]);

  return null;
}

interface RichMarkdownEditorHandlePluginProps {
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

export function RichMarkdownEditorHandlePlugin({
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
}: RichMarkdownEditorHandlePluginProps) {
  const editorModeRef = useRef<RevealMode>(REVEAL_MODE.LEXICAL);
  const focusOwnerRef = useRef<SurfaceFocusOwner>(focusOwner);
  focusOwnerRef.current = focusOwner;

  return (
    <MarkdownEditorHandlePlugin
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
