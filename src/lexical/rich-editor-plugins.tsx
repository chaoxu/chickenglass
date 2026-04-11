import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { registerCodeHighlighting } from "@lexical/code";
import { copyToClipboard } from "@lexical/clipboard";
import { SelectionAlwaysOnDisplay } from "@lexical/react/LexicalSelectionAlwaysOnDisplay";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  CUT_COMMAND,
  FORMAT_TEXT_COMMAND,
  HISTORY_MERGE_TAG,
  PASTE_COMMAND,
  PASTE_TAG,
  type LexicalEditor,
  isDOMNode,
  isSelectionCapturedInDecoratorInput,
  mergeRegister,
} from "lexical";

import {
  applyEditorDocumentChanges,
} from "../lib/editor-doc-change";
import type { SurfaceFocusOwner } from "../state/editor-focus";
import { dispatchSurfaceFocusRequest } from "./editor-focus-plugin";
import { useLexicalRenderContext } from "./render-context";
import {
  getCoflatClipboardData,
  getCoflatMarkdownFromDataTransfer,
  insertCoflatMarkdownAtSelection,
} from "./clipboard";
import {
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import {
  scrollSourcePositionIntoView,
} from "./source-position-plugin";
import { COFLAT_FORMAT_EVENT_TAG } from "./update-tags";
import { useDevSettings } from "../state/dev-settings";
import { useEditorScrollSurface } from "../lexical-next";
import type {
  MarkdownEditorHandle,
  MarkdownEditorSelection,
} from "./markdown-editor-types";
import { FORMAT_EVENT, type FormatEventDetail } from "../constants/events";

export function SelectionAlwaysOnPlugin() {
  const open = useDevSettings((s) => s.selectionAlwaysOn);
  if (!open) return null;
  return <SelectionAlwaysOnDisplay />;
}

export function getViewportFromRichSurface(root: HTMLElement): number {
  const headings = [...root.querySelectorAll<HTMLElement>(".cf-lexical-heading[data-coflat-heading-pos]")];
  if (headings.length === 0) {
    return 0;
  }

  const threshold = root.getBoundingClientRect().top + 24;
  let active = 0;

  for (const heading of headings) {
    const pos = Number(heading.dataset.coflatHeadingPos ?? "");
    if (!Number.isFinite(pos)) {
      continue;
    }

    if (heading.getBoundingClientRect().top <= threshold) {
      active = pos;
      continue;
    }

    break;
  }

  return active;
}

function hasEditableTextSelection(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) {
    return false;
  }

  const anchorNode = selection.anchorNode;
  const anchorElement = anchorNode instanceof Element
    ? anchorNode
    : anchorNode?.parentElement;
  const textLeaf = anchorElement?.closest("[data-lexical-text='true']");
  return Boolean(textLeaf && root.contains(textLeaf));
}


export function EditableSyncPlugin({
  editable,
}: {
  readonly editable: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);

  return null;
}

function isInlineTextFormatEvent(
  detail: FormatEventDetail,
): detail is Extract<FormatEventDetail, { type: "bold" | "code" | "highlight" | "italic" | "strikethrough" }> {
  return detail.type === "bold"
    || detail.type === "code"
    || detail.type === "highlight"
    || detail.type === "italic"
    || detail.type === "strikethrough";
}

function editorOwnsActiveSelection(root: HTMLElement | null): boolean {
  if (!root) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !selection.focusNode) {
    return false;
  }

  const activeElement = document.activeElement;
  return root.contains(selection.anchorNode)
    && root.contains(selection.focusNode)
    && !!activeElement
    && (activeElement === root || root.contains(activeElement));
}

export function FormatEventPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const handleFormat = (event: Event) => {
      const detail = (event as CustomEvent<FormatEventDetail>).detail;
      if (!isInlineTextFormatEvent(detail)) {
        return;
      }

      const root = editor.getRootElement();
      if (!editorOwnsActiveSelection(root)) {
        return;
      }

      editor.update(() => {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, detail.type);
      }, {
        discrete: true,
        tag: COFLAT_FORMAT_EVENT_TAG,
      });
    };

    document.addEventListener(FORMAT_EVENT, handleFormat);
    return () => {
      document.removeEventListener(FORMAT_EVENT, handleFormat);
    };
  }, [editor]);

  return null;
}

export function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerCodeHighlighting(editor), [editor]);

  return null;
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
      preservePendingLocalHistory
        ? { tag: HISTORY_MERGE_TAG }
        : undefined,
    );
    if (!preservePendingLocalHistory) {
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
    pendingLocalEchoDocRef.current = null;
    lastCommittedDocRef.current = doc;
  }, [doc, editor, lastCommittedDocRef, pendingLocalEchoDocRef, preserveLocalHistory]);

  return null;
}

function clampOffset(offset: number, docLength: number): number {
  return Math.max(0, Math.min(offset, docLength));
}

export function createMarkdownSelection(
  anchor: number,
  focus = anchor,
  docLength = Number.MAX_SAFE_INTEGER,
): MarkdownEditorSelection {
  const nextAnchor = clampOffset(anchor, docLength);
  const nextFocus = clampOffset(focus, docLength);
  return {
    anchor: nextAnchor,
    focus: nextFocus,
    from: Math.min(nextAnchor, nextFocus),
    to: Math.max(nextAnchor, nextFocus),
  };
}

export function storeSelection(
  selectionRef: MutableRefObject<MarkdownEditorSelection>,
  docLength: number,
  onSelectionChange: ((selection: MarkdownEditorSelection) => void) | undefined,
  anchor: number,
  focus = anchor,
): MarkdownEditorSelection {
  const nextSelection = createMarkdownSelection(anchor, focus, docLength);
  selectionRef.current = nextSelection;
  onSelectionChange?.(nextSelection);
  return nextSelection;
}

interface EditorHandlePluginProps {
  readonly focusOwner: SurfaceFocusOwner;
  readonly onEditorReady?: (handle: MarkdownEditorHandle, editor: LexicalEditor) => void;
  readonly onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  readonly selectionRef: MutableRefObject<MarkdownEditorSelection>;
  readonly userEditPendingRef: MutableRefObject<boolean>;
}

export function EditorHandlePlugin({
  focusOwner,
  onEditorReady,
  onSelectionChange,
  selectionRef,
  userEditPendingRef,
}: EditorHandlePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onEditorReady) {
      return;
    }

    onEditorReady({
      applyChanges: (changes) => {
        if (changes.length === 0) {
          return;
        }

        const currentDoc = getLexicalMarkdown(editor);
        const nextDoc = applyEditorDocumentChanges(currentDoc, changes);
        if (nextDoc === currentDoc) {
          storeSelection(
            selectionRef,
            currentDoc.length,
            onSelectionChange,
            selectionRef.current.anchor,
            selectionRef.current.focus,
          );
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
        setLexicalMarkdown(editor, nextDoc);
      },
      focus: () => {
        scrollSourcePositionIntoView(editor, editor.getRootElement(), selectionRef.current.from);
        dispatchSurfaceFocusRequest(editor, { owner: focusOwner });
      },
      getDoc: () => getLexicalMarkdown(editor),
      getSelection: () => selectionRef.current,
      insertText: (text) => {
        const currentDoc = getLexicalMarkdown(editor);
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
        userEditPendingRef.current = true;
        storeSelection(selectionRef, nextDoc.length, onSelectionChange, nextOffset);
        setLexicalMarkdown(editor, nextDoc);
      },
      setDoc: (doc) => {
        const currentDoc = getLexicalMarkdown(editor);
        if (doc === currentDoc) {
          storeSelection(
            selectionRef,
            currentDoc.length,
            onSelectionChange,
            selectionRef.current.anchor,
            selectionRef.current.focus,
          );
          return;
        }
        userEditPendingRef.current = true;
        storeSelection(
          selectionRef,
          doc.length,
          onSelectionChange,
          selectionRef.current.anchor,
          selectionRef.current.focus,
        );
        setLexicalMarkdown(editor, doc);
      },
      setSelection: (anchor, focus = anchor) => {
        const nextSelection = storeSelection(
          selectionRef,
          getLexicalMarkdown(editor).length,
          onSelectionChange,
          anchor,
          focus,
        );
        scrollSourcePositionIntoView(editor, editor.getRootElement(), nextSelection.from);
        dispatchSurfaceFocusRequest(editor, { owner: focusOwner });
      },
    }, editor);
  }, [editor, focusOwner, onEditorReady, onSelectionChange, selectionRef, userEditPendingRef]);

  return null;
}

function getClipboardEvent(
  event: ClipboardEvent | KeyboardEvent | null,
): ClipboardEvent | null {
  return event && "clipboardData" in event
    ? event as ClipboardEvent
    : null;
}

function getPasteClipboardData(
  event: ClipboardEvent | InputEvent | KeyboardEvent,
): DataTransfer | null {
  return "clipboardData" in event
    ? event.clipboardData ?? null
    : null;
}

export function CoflatClipboardPlugin() {
  const [editor] = useLexicalComposerContext();
  const renderContext = useLexicalRenderContext();

  useEffect(() => {
    const getClipboardData = () => editor.getEditorState().read(() =>
      getCoflatClipboardData(editor, renderContext, $getSelection())
    );

    return mergeRegister(
      editor.registerCommand(COPY_COMMAND, (event) => {
        const clipboardData = getClipboardData();
        if (!clipboardData) {
          return false;
        }

        void copyToClipboard(editor, getClipboardEvent(event), clipboardData);
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CUT_COMMAND, (event) => {
        const clipboardData = getClipboardData();
        if (!clipboardData) {
          return false;
        }

        void copyToClipboard(editor, getClipboardEvent(event), clipboardData).then((copied) => {
          if (!copied) {
            return;
          }

          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.removeText();
              return;
            }

            if ($isNodeSelection(selection)) {
              for (const node of selection.getNodes()) {
                node.remove();
              }
            }
          });
        });

        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(PASTE_COMMAND, (event) => {
        const clipboardData = getPasteClipboardData(event);
        if (!clipboardData) {
          return false;
        }

        if (isDOMNode(event.target) && isSelectionCapturedInDecoratorInput(event.target)) {
          return false;
        }

        const markdown = getCoflatMarkdownFromDataTransfer(clipboardData);
        if (!markdown) {
          return false;
        }

        const inserted = insertCoflatMarkdownAtSelection(editor, markdown, {
          tag: PASTE_TAG,
        });
        if (!inserted) {
          return false;
        }

        event.preventDefault();
        return true;
      }, COMMAND_PRIORITY_HIGH),
    );
  }, [editor, renderContext]);

  return null;
}

export function ViewportTrackingPlugin({
  onViewportFromChange,
}: {
  readonly onViewportFromChange?: (from: number) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const surface = useEditorScrollSurface();

  useEffect(() => {
    if (!onViewportFromChange || !surface || typeof window === "undefined") {
      return;
    }

    let frame = 0;

    const sync = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(() => {
        frame = 0;
        const root = editor.getRootElement();
        if (!root) {
          return;
        }
        onViewportFromChange(getViewportFromRichSurface(root));
      });
    };

    surface.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      surface.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [editor, onViewportFromChange, surface]);

  return null;
}

export function RootElementPlugin({
  onRootElementChange,
}: {
  readonly onRootElementChange?: (root: HTMLElement | null) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onRootElementChange) {
      return;
    }

    onRootElementChange(editor.getRootElement());
    return editor.registerRootListener((rootElement) => {
      onRootElementChange(rootElement);
    });
  }, [editor, onRootElementChange]);

  return null;
}

export function repairBlankClickSelection(root: HTMLElement, event: React.MouseEvent): void {
  if (hasEditableTextSelection(root)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.caretRangeFromPoint(event.clientX, event.clientY);
  if (range && root.contains(range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
