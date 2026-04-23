import { useEffect } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode } from "@lexical/rich-text";
import {
  $addUpdateTag,
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
  type TextNode,
} from "lexical";

import { getInlineTextFormatSpec, useEditorScrollSurface } from "./runtime";
import type { FormatEventDetail } from "../constants/events";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import {
  HEADING_SOURCE_SELECTOR,
  SOURCE_POSITION_DATASET,
} from "./source-position-contract";
import {
  $readSourceTextSelectionFromLexicalRoot,
  readSourceTextFromLexicalRoot,
  selectSourceOffsetsInLexicalRoot,
  writeSourceTextToLexicalRoot,
} from "./source-text";
import { FORMAT_MARKDOWN_COMMAND } from "./editor-format-command";
import { COFLAT_FORMAT_COMMIT_TAG } from "./update-tags";
import { domTextOffsetWithin } from "./dom-selection";

/**
 * Pure helpers and shared plugins for the rich/source markdown editor
 * wrappers. `markdown-editor.tsx` and `rich-markdown-editor.tsx` historically
 * carried byte-identical copies of each definition below; consolidating here
 * removes the drift hazard (issue #107).
 */

const pendingDestructiveVisibleOffsetByEditor = new WeakMap<LexicalEditor, number>();

export function consumePendingDestructiveVisibleOffset(
  editor: LexicalEditor,
): number | null {
  const offset = pendingDestructiveVisibleOffsetByEditor.get(editor);
  pendingDestructiveVisibleOffsetByEditor.delete(editor);
  return offset ?? null;
}

export function getViewportFromRichSurface(root: HTMLElement, viewportOwner: HTMLElement = root): number {
  const headings = [...root.querySelectorAll<HTMLElement>(HEADING_SOURCE_SELECTOR)];
  if (headings.length === 0) {
    return 0;
  }

  const threshold = viewportOwner.getBoundingClientRect().top + 24;
  let active = 0;

  for (const heading of headings) {
    const pos = Number(heading.dataset[SOURCE_POSITION_DATASET.headingPos] ?? "");
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

export function hasEditableTextSelection(root: HTMLElement): boolean {
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

function getCaretRangeFromPoint(
  documentRef: Document,
  x: number,
  y: number,
): Range | null {
  if (typeof documentRef.caretRangeFromPoint === "function") {
    return documentRef.caretRangeFromPoint(x, y);
  }

  if (typeof documentRef.caretPositionFromPoint === "function") {
    const position = documentRef.caretPositionFromPoint(x, y);
    if (!position) {
      return null;
    }

    const range = documentRef.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  return null;
}

export function repairBlankClickSelection(root: HTMLElement, event: ReactMouseEvent): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  if (!selection.isCollapsed) {
    return;
  }

  if (hasEditableTextSelection(root)) {
    return;
  }

  const range = getCaretRangeFromPoint(document, event.clientX, event.clientY);
  if (range && root.contains(range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }

  const fallbackRange = document.createRange();
  fallbackRange.selectNodeContents(root);
  fallbackRange.collapse(false);
  selection.removeAllRanges();
  selection.addRange(fallbackRange);
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

export function EditableSyncPlugin({
  editable,
}: {
  readonly editable: boolean;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);

  return null;
}

export function ViewportTrackingPlugin({
  onViewportFromChange,
}: {
  readonly onViewportFromChange?: (from: number) => void;
}): null {
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
        onViewportFromChange(getViewportFromRichSurface(root, surface));
      });
    };

    const unregisterHeadingMutations = editor.registerMutationListener(HeadingNode, (mutations) => {
      if (mutations.size > 0) {
        sync();
      }
    });

    surface.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      surface.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      unregisterHeadingMutations();
    };
  }, [editor, onViewportFromChange, surface]);

  return null;
}

export function RootElementPlugin({
  onRootElementChange,
}: {
  readonly onRootElementChange?: (root: HTMLElement | null) => void;
}): null {
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

function destructiveKeyNeedsDomSelectionSync(event: KeyboardEvent): boolean {
  return event.key === "Backspace" || event.key === "Delete";
}

function domPointToTextNodePoint(
  domNode: Node,
  offset: number,
): { readonly node: TextNode; readonly offset: number } | null {
  const lexicalNode = $getNearestNodeFromDOMNode(domNode);
  if (!$isTextNode(lexicalNode)) {
    return null;
  }
  const size = lexicalNode.getTextContentSize();
  return {
    node: lexicalNode,
    offset: Math.max(0, Math.min(offset, size)),
  };
}

function rootChildContaining(root: HTMLElement, node: Node): HTMLElement {
  let current = node instanceof HTMLElement ? node : node.parentElement;
  while (current?.parentElement && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current ?? root;
}

function textPointAtVisibleOffset(
  root: HTMLElement,
  offset: number,
): { readonly node: Text; readonly offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastText: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) {
      continue;
    }
    lastText = node;
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }
  return lastText
    ? { node: lastText, offset: lastText.textContent?.length ?? 0 }
    : null;
}

function restoreCollapsedSelectionAt(
  editor: LexicalEditor,
  block: HTMLElement,
  offset: number,
): void {
  const target = textPointAtVisibleOffset(block, offset);
  if (!target) {
    return;
  }

  const range = block.ownerDocument.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);
  const domSelection = block.ownerDocument.getSelection();
  domSelection?.removeAllRanges();
  domSelection?.addRange(range);

  editor.update(() => {
    const point = domPointToTextNodePoint(target.node, target.offset);
    if (!point) {
      return;
    }
    point.node.select(point.offset, point.offset);
  }, { discrete: true });
}

export function DestructiveKeySelectionSyncPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let pendingRestore: (() => void) | null = null;
    let cleanupPendingKeyUp: (() => void) | null = null;
    let cleanupPendingUpdateRestore: (() => void) | null = null;
    let pendingRestoreTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPendingRestoreTimer = () => {
      if (pendingRestoreTimer !== null) {
        clearTimeout(pendingRestoreTimer);
        pendingRestoreTimer = null;
      }
    };
    const clearPendingKeyUp = () => {
      cleanupPendingKeyUp?.();
      cleanupPendingKeyUp = null;
    };
    const clearPendingUpdateRestore = () => {
      cleanupPendingUpdateRestore?.();
      cleanupPendingUpdateRestore = null;
    };
    const runPendingRestore = () => {
      clearPendingRestoreTimer();
      clearPendingKeyUp();
      clearPendingUpdateRestore();
      const restore = pendingRestore;
      pendingRestore = null;
      restore?.();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!destructiveKeyNeedsDomSelectionSync(event)) {
        return;
      }

      const root = editor.getRootElement();
      const selection = root?.ownerDocument.getSelection();
      const { anchorNode, focusNode } = selection ?? {};
      if (
        !root
        || !selection
        || selection.isCollapsed
        || selection.rangeCount === 0
        || !anchorNode
        || !focusNode
        || !root.contains(anchorNode)
        || !root.contains(focusNode)
      ) {
        return;
      }

      const selectedRange = selection.getRangeAt(0);
      const collapseBlock = rootChildContaining(root, selectedRange.startContainer);
      const rootCollapseOffset = domTextOffsetWithin(
        root,
        selectedRange.startContainer,
        selectedRange.startOffset,
      );
      const collapseOffset = domTextOffsetWithin(
        collapseBlock,
        selectedRange.startContainer,
        selectedRange.startOffset,
      );

      editor.update(() => {
        const anchor = domPointToTextNodePoint(anchorNode, selection.anchorOffset);
        const focus = domPointToTextNodePoint(focusNode, selection.focusOffset);
        if (!anchor || !focus) {
          return;
        }
        const nextSelection = $createRangeSelection();
        nextSelection.anchor.set(anchor.node.getKey(), anchor.offset, "text");
        nextSelection.focus.set(focus.node.getKey(), focus.offset, "text");
        $setSelection(nextSelection);
      }, { discrete: true });

      if (rootCollapseOffset !== null) {
        pendingDestructiveVisibleOffsetByEditor.set(editor, rootCollapseOffset);
      }
      if (collapseOffset !== null) {
        clearPendingRestoreTimer();
        clearPendingKeyUp();
        clearPendingUpdateRestore();
        pendingRestore = () => {
          restoreCollapsedSelectionAt(
            editor,
            collapseBlock.isConnected ? collapseBlock : root,
            collapseOffset,
          );
        };
        const cleanupKeyUp = () => {
          root.ownerDocument.removeEventListener("keyup", restoreOnKeyUp, true);
          if (cleanupPendingKeyUp === cleanupKeyUp) {
            cleanupPendingKeyUp = null;
          }
        };
        const restoreOnKeyUp = (keyUpEvent: KeyboardEvent) => {
          if (keyUpEvent.key !== event.key) {
            return;
          }
          cleanupKeyUp();
          clearPendingRestoreTimer();
          let unregister: (() => void) | null = null;
          let fallback: ReturnType<typeof setTimeout> | null = null;
          const cleanupUpdateRestore = () => {
            unregister?.();
            unregister = null;
            if (fallback !== null) {
              clearTimeout(fallback);
              fallback = null;
            }
            if (cleanupPendingUpdateRestore === cleanupUpdateRestore) {
              cleanupPendingUpdateRestore = null;
            }
          };
          const restoreAfterUpdate = () => {
            cleanupUpdateRestore();
            runPendingRestore();
          };
          cleanupPendingUpdateRestore = cleanupUpdateRestore;
          unregister = editor.registerUpdateListener(restoreAfterUpdate);
          fallback = setTimeout(restoreAfterUpdate, 100);
        };
        root.ownerDocument.addEventListener("keyup", restoreOnKeyUp, true);
        cleanupPendingKeyUp = cleanupKeyUp;
        pendingRestoreTimer = setTimeout(() => {
          pendingRestoreTimer = null;
          runPendingRestore();
        }, 100);
      }
    };

    const handleInput = () => {
      runPendingRestore();
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("keydown", handleKeyDown, true);
      previousRootElement?.removeEventListener("input", handleInput, true);
      clearPendingRestoreTimer();
      clearPendingKeyUp();
      clearPendingUpdateRestore();
      if (!rootElement) {
        return;
      }
      rootElement.addEventListener("keydown", handleKeyDown, true);
      rootElement.addEventListener("input", handleInput, true);
      return () => {
        clearPendingRestoreTimer();
        clearPendingKeyUp();
        clearPendingUpdateRestore();
        rootElement.removeEventListener("keydown", handleKeyDown, true);
        rootElement.removeEventListener("input", handleInput, true);
      };
    });
  }, [editor]);

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
  const activeEditorRoot = activeElement instanceof HTMLElement
    ? activeElement.closest<HTMLElement>("[data-lexical-editor='true']")
    : null;
  return root.contains(selection.anchorNode)
    && root.contains(selection.focusNode)
    && !!activeElement
    && (activeElement === root || root.contains(activeElement))
    && activeEditorRoot === root;
}

function isSourceEditorRoot(root: HTMLElement | null): boolean {
  return root?.classList.contains("cf-lexical-editor--source") ?? false;
}

function sourceDomOffset(root: HTMLElement, target: Node, targetOffset: number): number | null {
  let offset = 0;
  for (const [paragraphIndex, paragraph] of [...root.childNodes].entries()) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === target) {
        return offset + Math.max(0, Math.min(targetOffset, node.textContent?.length ?? 0));
      }
      offset += node.textContent?.length ?? 0;
    }
    if (target === paragraph) {
      return offset;
    }
    if (paragraphIndex < root.childNodes.length - 1) {
      offset += 1;
    }
  }
  return null;
}

function readSourceDomSelection(root: HTMLElement): MarkdownEditorSelection | null {
  const selection = window.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
    return null;
  }
  const anchor = sourceDomOffset(root, anchorNode, selection.anchorOffset);
  const focus = sourceDomOffset(root, focusNode, selection.focusOffset);
  if (anchor === null || focus === null) {
    return null;
  }
  return {
    anchor,
    focus,
    from: Math.min(anchor, focus),
    to: Math.max(anchor, focus),
  };
}

function applySourceFormat(
  detail: Extract<FormatEventDetail, { type: "bold" | "code" | "highlight" | "italic" | "strikethrough" }>,
  domSelection: MarkdownEditorSelection | null,
): void {
  const selection = domSelection ?? $readSourceTextSelectionFromLexicalRoot();
  if (selection.from === selection.to) {
    return;
  }

  const spec = getInlineTextFormatSpec(detail.type);
  const text = readSourceTextFromLexicalRoot();
  const selected = text.slice(selection.from, selection.to);
  const nextText = [
    text.slice(0, selection.from),
    spec.markdownOpen,
    selected,
    spec.markdownClose,
    text.slice(selection.to),
  ].join("");
  const nextAnchor = selection.from + spec.markdownOpen.length + selected.length + spec.markdownClose.length;
  writeSourceTextToLexicalRoot(nextText);
  selectSourceOffsetsInLexicalRoot(nextAnchor, nextAnchor);
}

export function FormatEventPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      FORMAT_MARKDOWN_COMMAND,
      (detail) => {
        if (!isInlineTextFormatEvent(detail)) {
          return false;
        }

        const root = editor.getRootElement();
        if (!editorOwnsActiveSelection(root)) {
          return false;
        }
        if (!root) {
          return false;
        }

        if (isSourceEditorRoot(root)) {
          const domSelection = readSourceDomSelection(root);
          applySourceFormat(detail, domSelection);
          return true;
        }
        editor.update(() => {
          $addUpdateTag(COFLAT_FORMAT_COMMIT_TAG);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.formatText(detail.type);
          }
        }, { discrete: true });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  return null;
}

/**
 * Keeps a selection ref clamped inside the current document on every doc
 * swap. Used by wrappers that expose a mutable selection ref whose values
 * must stay within bounds when the document changes out from under them.
 */
export function useMarkdownSelectionRefSync(
  doc: string,
  selectionRef: MutableRefObject<MarkdownEditorSelection>,
): void {
  useEffect(() => {
    selectionRef.current = createMarkdownSelection(
      selectionRef.current.anchor,
      selectionRef.current.focus,
      doc.length,
    );
  }, [doc, selectionRef]);
}
