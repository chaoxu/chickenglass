import { useEffect } from "react";
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { FORMAT_TEXT_COMMAND } from "lexical";

import { getInlineTextFormatSpec, useEditorScrollSurface } from "../lexical-next";
import { FORMAT_EVENT, type FormatEventDetail } from "../constants/events";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import {
  HEADING_SOURCE_SELECTOR,
  SOURCE_POSITION_DATASET,
} from "./source-position-contract";
import { COFLAT_FORMAT_EVENT_TAG } from "./update-tags";
import {
  $readSourceTextSelectionFromLexicalRoot,
  readSourceTextFromLexicalRoot,
  selectSourceOffsetsInLexicalRoot,
  writeSourceTextToLexicalRoot,
} from "./source-text";

/**
 * Pure helpers and shared plugins for the rich/source markdown editor
 * wrappers. `markdown-editor.tsx` and `rich-markdown-editor.tsx` historically
 * carried byte-identical copies of each definition below; consolidating here
 * removes the drift hazard (issue #107).
 */

export function getViewportFromRichSurface(root: HTMLElement): number {
  const headings = [...root.querySelectorAll<HTMLElement>(HEADING_SOURCE_SELECTOR)];
  if (headings.length === 0) {
    return 0;
  }

  const threshold = root.getBoundingClientRect().top + 24;
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
        onViewportFromChange(getViewportFromRichSurface(root));
      });
    };

    const unregisterUpdate = editor.registerUpdateListener(() => {
      sync();
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
      unregisterUpdate();
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
    const handleFormat = (event: Event) => {
      const detail = (event as CustomEvent<FormatEventDetail>).detail;
      if (!isInlineTextFormatEvent(detail)) {
        return;
      }

      const root = editor.getRootElement();
      if (!editorOwnsActiveSelection(root)) {
        return;
      }
      if (!root) {
        return;
      }

      editor.update(() => {
        if (isSourceEditorRoot(root)) {
          const domSelection = readSourceDomSelection(root);
          applySourceFormat(detail, domSelection);
          return;
        }
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, detail.type);
      }, {
        discrete: true,
        tag: COFLAT_FORMAT_EVENT_TAG,
      });
      event.stopImmediatePropagation();
    };

    document.addEventListener(FORMAT_EVENT, handleFormat);
    return () => {
      document.removeEventListener(FORMAT_EVENT, handleFormat);
    };
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
