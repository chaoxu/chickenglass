import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";

import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import {
  createHeadlessCoflatEditor,
  setLexicalMarkdown,
} from "./markdown";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { parseStructuredFencedDivRaw } from "./markdown/block-syntax";
import { parseFootnoteDefinition } from "./markdown/footnotes";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import {
  getPendingEmbeddedSurfaceFocusId,
  queuePendingSurfaceFocus,
  type PendingEmbeddedSurfaceFocusTarget,
} from "./pending-surface-focus";
import { sourcePositionFromElement } from "./source-position-dom";
import {
  createSourceSpanIndex,
  type SourceLocation,
  type SourceSpanIndex,
} from "./source-spans";
import {
  fencedDivBodyMarkdownOffset,
  fencedDivTitleMarkdownOffset,
  footnoteDefinitionBodyOffset,
  footnoteDefinitionRawOffsetToBodyOffset,
} from "./structure-source-offsets";
import {
  ACTIVATE_STRUCTURE_EDIT_COMMAND,
  type ActivateStructureEditRequest,
} from "./structure-edit-plugin";

interface SourceSelectionReadOptions {
  readonly fallback?: MarkdownEditorSelection;
  readonly markdown?: string;
}

interface CachedSourceSpanIndex {
  readonly markdown: string;
  readonly spanIndex: SourceSpanIndex;
}

const readSourceSpanIndexCache = new WeakMap<EditorState, CachedSourceSpanIndex>();

function readCachedSourceSpanIndex(
  editorState: EditorState,
  markdown: string,
): SourceSpanIndex {
  const cached = readSourceSpanIndexCache.get(editorState);
  if (cached?.markdown === markdown) {
    return cached.spanIndex;
  }
  const spanIndex = createSourceSpanIndex(markdown);
  readSourceSpanIndexCache.set(editorState, { markdown, spanIndex });
  return spanIndex;
}

export function mapVisibleTextOffsetToMarkdown(
  markdown: string,
  visibleOffset: number,
  affinity: "backward" | "forward" = "forward",
): number | null {
  const probeEditor = createHeadlessCoflatEditor();
  setLexicalMarkdown(probeEditor, markdown);

  return probeEditor.getEditorState().read(() => {
    const spanIndex = createSourceSpanIndex(markdown);
    let remaining = Math.max(0, visibleOffset);
    let lastTextNode: TextNode | null = null;

    const visit = (node: LexicalNode): { readonly node: TextNode; readonly offset: number } | null => {
      if ($isTextNode(node)) {
        lastTextNode = node;
        const length = node.getTextContentSize();
        if (remaining < length || (remaining === length && affinity === "backward")) {
          return { node, offset: remaining };
        }
        remaining -= length;
        return null;
      }

      if (!$isElementNode(node)) {
        remaining -= node.getTextContent().length;
        return null;
      }

      for (const child of node.getChildren()) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return null;
    };

    const location = visit($getRoot());
    if (location) {
      return spanIndex.getTextNodeOffset(location.node, location.offset);
    }
    if (lastTextNode === null) {
      return null;
    }
    const fallbackNode = lastTextNode as TextNode;
    return spanIndex.getTextNodeOffset(fallbackNode, fallbackNode.getTextContentSize());
  });
}

export function getMarkdownVisibleTextLength(markdown: string): number {
  const probeEditor = createHeadlessCoflatEditor();
  setLexicalMarkdown(probeEditor, markdown);
  return probeEditor.getEditorState().read(() => $getRoot().getTextContent().length);
}

export function mapVisibleTextSelectionToMarkdown(
  markdown: string,
  selection: MarkdownEditorSelection,
): MarkdownEditorSelection | null {
  const anchorAffinity = selection.anchor <= selection.focus ? "forward" : "backward";
  const focusAffinity = selection.anchor <= selection.focus ? "backward" : "forward";
  const anchor = mapVisibleTextOffsetToMarkdown(markdown, selection.anchor, anchorAffinity);
  const focus = mapVisibleTextOffsetToMarkdown(markdown, selection.focus, focusAffinity);
  if (anchor === null || focus === null) {
    return null;
  }
  return createSourceSelection(anchor, focus, markdown.length);
}

function readSourceOffsetFromElementBoundary(
  node: LexicalNode,
  offset: number,
  spanIndex: SourceSpanIndex | null,
): number | null {
  if (!spanIndex || !$isElementNode(node)) {
    return null;
  }

  const children = node.getChildren();
  if (offset > 0) {
    const previous = children[offset - 1];
    if (previous) {
      const sourceOffset = spanIndex.getNodeEnd(previous);
      if (sourceOffset !== null) return sourceOffset;
    }
  }

  const next = children[offset];
  return next ? spanIndex.getNodeStart(next) : null;
}

function readSourceOffsetFromRangePoint(
  editor: LexicalEditor,
  point: { readonly getNode: () => LexicalNode; readonly offset: number },
  spanIndex: SourceSpanIndex | null,
): number | null {
  const node = point.getNode();
  if ($isTextNode(node)) {
    const previousSibling = point.offset === 0 ? node.getPreviousSibling() : null;
    const previousEditableEnd = previousSibling
      ? spanIndex?.getRevealNodeEditableEnd(previousSibling)
      : null;
    if (previousEditableEnd !== null && previousEditableEnd !== undefined) {
      return previousEditableEnd;
    }

    const spanOffset = spanIndex?.getTextNodeOffset(node, point.offset) ?? null;
    if (spanOffset !== null) {
      return spanOffset;
    }
  }

  const boundaryOffset = readSourceOffsetFromElementBoundary(node, point.offset, spanIndex);
  if (boundaryOffset !== null) {
    return boundaryOffset;
  }

  const element = editor.getElementByKey(node.getKey());
  return sourcePositionFromElement(element);
}

function createSourceSelection(
  anchor: number,
  focus: number,
  docLength: number,
): MarkdownEditorSelection {
  const nextAnchor = Math.max(0, Math.min(anchor, docLength));
  const nextFocus = Math.max(0, Math.min(focus, docLength));
  return {
    anchor: nextAnchor,
    focus: nextFocus,
    from: Math.min(nextAnchor, nextFocus),
    to: Math.max(nextAnchor, nextFocus),
  };
}

type RevealSourceLocation = Extract<SourceLocation, { kind: "reveal" }>;
type RawBlockSourceLocation = RevealSourceLocation & { readonly adapterId: "raw-block" };

function isRawBlockSourceLocation(location: SourceLocation | null): location is RawBlockSourceLocation {
  return location?.kind === "reveal" && location.adapterId === "raw-block";
}

function applyCollapsedTextFormat(node: TextNode, collapsed: boolean): void {
  if (!collapsed) {
    return;
  }

  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return;
  }

  selection.format = node.getFormat();
  selection.style = node.getStyle();
}

interface SelectSourceOffsetsOptions {
  readonly revealRawBlockAtBoundary?: boolean;
  readonly revealRawBlocks?: boolean;
}

function createRevealRequestFromSourceLocation(
  location: RevealSourceLocation,
  options: SelectSourceOffsetsOptions,
): CursorRevealOpenRequest | null {
  if (location.adapterId === "raw-block" && options.revealRawBlocks === false) {
    return null;
  }
  if (
    location.adapterId === "raw-block"
    && location.offset === 0
    && options.revealRawBlockAtBoundary === false
  ) {
    return null;
  }
  return {
    adapterId: location.adapterId,
    caretOffset: Math.max(0, Math.min(location.offset, location.source.length)),
    entry: "selection",
    nodeKey: location.node.getKey(),
    source: location.source,
  };
}

function clampedFieldOffset(offset: number, fieldStart: number, fieldLength: number): number {
  return Math.max(0, Math.min(offset - fieldStart, fieldLength));
}

function queueEmbeddedRawBlockFocus(
  editor: LexicalEditor,
  location: RawBlockSourceLocation,
): ActivateStructureEditRequest | boolean {
  if (!$isRawBlockNode(location.node)) {
    return false;
  }

  const raw = location.source;
  const offset = Math.max(0, Math.min(location.offset, raw.length));
  let target: PendingEmbeddedSurfaceFocusTarget | null = null;
  let fieldOffset = 0;
  let activateStructureEdit: ActivateStructureEditRequest | null = null;

  const footnote = parseFootnoteDefinition(raw);
  if (footnote) {
    const bodyStart = footnoteDefinitionBodyOffset(raw);
    if (offset >= bodyStart) {
      target = "footnote-body";
      fieldOffset = Math.max(
        0,
        Math.min(footnoteDefinitionRawOffsetToBodyOffset(raw, offset), footnote.body.length),
      );
    } else {
      target = "structure-source";
      fieldOffset = offset;
      activateStructureEdit = {
        blockKey: location.node.getKey(),
        surface: "footnote-source",
        variant: "footnote-definition",
      };
    }
  } else if (/^\s*:{3,}/.test(raw)) {
    const parsed = parseStructuredFencedDivRaw(raw);
    const titleStart = fencedDivTitleMarkdownOffset(raw, parsed);
    const titleMarkdown = parsed.titleMarkdown ?? "";
    if (titleStart !== null && titleMarkdown) {
      const titleEnd = titleStart + titleMarkdown.length;
      if (offset >= titleStart && offset <= titleEnd) {
        target = parsed.blockType === "figure" || parsed.blockType === "table"
          ? "block-caption"
          : "block-title";
        fieldOffset = clampedFieldOffset(offset, titleStart, titleMarkdown.length);
      }
    }

    if (target === null) {
      const bodyStart = fencedDivBodyMarkdownOffset(raw);
      if (offset >= bodyStart) {
        target = "block-body";
        fieldOffset = clampedFieldOffset(offset, bodyStart, parsed.bodyMarkdown.length);
      }
    }
  } else if (/^\s*(?:\$\$|\\\[)/.test(raw)) {
    target = "structure-source";
    fieldOffset = offset;
    activateStructureEdit = {
      blockKey: location.node.getKey(),
      surface: "display-math-source",
      variant: "display-math",
    };
  }

  if (target === null) {
    return false;
  }

  queuePendingSurfaceFocus(
    getPendingEmbeddedSurfaceFocusId(editor.getKey(), location.node.getKey(), target),
    { offset: fieldOffset },
  );
  return activateStructureEdit ?? true;
}

export function selectSourceOffsetsInRichLexicalRoot(
  editor: LexicalEditor,
  markdown: string,
  anchor: number,
  focus = anchor,
  options: SelectSourceOffsetsOptions = {},
): boolean {
  let didSelect = false;
  let pendingRevealRequest: CursorRevealOpenRequest | null = null;
  let pendingStructureEditRequest: ActivateStructureEditRequest | null = null;
  editor.update(() => {
    const collapsed = anchor === focus;
    const spanIndex = createSourceSpanIndex(markdown);
    const directAnchorLocation = spanIndex.findNearestLocation(anchor);
    const directFocusLocation = collapsed
      ? directAnchorLocation
      : spanIndex.findNearestLocation(focus);
    const queueReveal = (request: CursorRevealOpenRequest | null): boolean => {
      if (!request) {
        return false;
      }
      pendingRevealRequest = request;
      didSelect = true;
      return true;
    };
    const queueEmbeddedFocus = (location: SourceLocation | null): boolean => {
      if (
        !isRawBlockSourceLocation(location)
      ) {
        return false;
      }
      const result = queueEmbeddedRawBlockFocus(editor, location);
      if (!result) {
        return false;
      }
      if (typeof result === "object") {
        pendingStructureEditRequest = result;
      }
      didSelect = true;
      return true;
    };
    const queueRevealOrEmbeddedFocus = (location: RevealSourceLocation): boolean => {
      if (location.adapterId !== "raw-block") {
        return queueReveal(createRevealRequestFromSourceLocation(location, options));
      }
      if (
        location.offset === 0
        && options.revealRawBlockAtBoundary === false
      ) {
        return false;
      }
      if (options.revealRawBlocks === false) {
        return queueEmbeddedFocus(location);
      }
      return (
        queueReveal(createRevealRequestFromSourceLocation(location, options))
        || queueEmbeddedFocus(location)
      );
    };
    if (
      collapsed
      && directAnchorLocation?.kind === "reveal"
      && queueRevealOrEmbeddedFocus(directAnchorLocation)
    ) {
      return;
    }
    if (
      directAnchorLocation?.kind === "text"
      && directFocusLocation?.kind === "text"
    ) {
      const { node: anchorNode, offset: anchorOffset } = directAnchorLocation;
      const { node: focusNode, offset: focusOffset } = directFocusLocation;
      if (anchorNode.is(focusNode)) {
        anchorNode.select(anchorOffset, focusOffset);
        applyCollapsedTextFormat(anchorNode, collapsed);
        didSelect = true;
        return;
      }

      const selection = $createRangeSelection();
      selection.anchor.set(anchorNode.getKey(), anchorOffset, "text");
      selection.focus.set(focusNode.getKey(), focusOffset, "text");
      $setSelection(selection);
      applyCollapsedTextFormat(anchorNode, collapsed);
      didSelect = true;
      return;
    }
  }, { discrete: true });

  if (pendingRevealRequest) {
    editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, pendingRevealRequest);
  }
  if (pendingStructureEditRequest) {
    editor.dispatchCommand(ACTIVATE_STRUCTURE_EDIT_COMMAND, pendingStructureEditRequest);
  }

  return didSelect;
}

export function readSourceSelectionFromLexicalSelection(
  editor: LexicalEditor,
  options: SourceSelectionReadOptions = {},
): MarkdownEditorSelection | null {
  const editorState = editor.getEditorState();

  return editorState.read(() => {
    const spanIndex = options.markdown
      ? readCachedSourceSpanIndex(editorState, options.markdown)
      : null;
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchor = readSourceOffsetFromRangePoint(editor, selection.anchor, spanIndex);
      const focus = readSourceOffsetFromRangePoint(editor, selection.focus, spanIndex);
      if (anchor !== null && focus !== null) {
        return createSourceSelection(
          anchor,
          focus,
          options.markdown?.length ?? Math.max(anchor, focus),
        );
      }

      const anchorElement = editor.getElementByKey(selection.anchor.getNode().getKey());
      const blockPosition = sourcePositionFromElement(anchorElement);
      if (blockPosition !== null) {
        return createSourceSelection(
          blockPosition,
          blockPosition,
          options.markdown?.length ?? blockPosition,
        );
      }

      return options.fallback ?? null;
    }

    if ($isNodeSelection(selection)) {
      const [node] = selection.getNodes();
      if (!node) {
        return options.fallback ?? null;
      }

      const element = editor.getElementByKey(node.getKey());
      const blockPosition = sourcePositionFromElement(element);
      if (blockPosition !== null) {
        return createSourceSelection(
          blockPosition,
          blockPosition,
          options.markdown?.length ?? blockPosition,
        );
      }
    }

    return options.fallback ?? null;
  });
}
