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
import { $isLinkNode, type LinkNode } from "@lexical/link";

import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import {
  createHeadlessCoflatEditor,
  exportMarkdownFromSerializedState,
  setLexicalMarkdown,
} from "./markdown";
import { getInlineTextFormatSpecs } from "../lexical-next";
import type { MarkdownEditorSelection } from "./markdown-editor-types";
import { $isFootnoteReferenceNode } from "./nodes/footnote-reference-node";
import { $isHeadingAttributeNode } from "./nodes/heading-attribute-node";
import { $isInlineImageNode } from "./nodes/inline-image-node";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { isRevealSourceStyle } from "./reveal-source-style";
import { sourcePositionFromElement } from "./source-position-dom";

const SOURCE_SELECTION_MARKER = "\uE000coflat-source-selection\uE001";
const SOURCE_NAVIGATION_MARKER = "\uE000coflat-source-navigation\uE001";

interface SourceSelectionReadOptions {
  readonly fallback?: MarkdownEditorSelection;
  readonly markdown?: string;
}

interface SerializedNodeRecord {
  readonly children?: unknown;
  text?: unknown;
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

function isSerializedNodeRecord(value: unknown): value is SerializedNodeRecord {
  return typeof value === "object" && value !== null;
}

function getNodePathFromRoot(node: LexicalNode): number[] | null {
  const path: number[] = [];
  let current: LexicalNode | null = node;

  while (current) {
    const parentNode: LexicalNode | null = current.getParent();
    if (!parentNode) {
      return path;
    }
    if (!$isElementNode(parentNode)) {
      return null;
    }

    const siblings: LexicalNode[] = parentNode.getChildren();
    const index = siblings.findIndex((sibling) => sibling.is(current));
    if (index < 0) {
      return null;
    }
    path.unshift(index);
    current = parentNode;
  }

  return null;
}

function getSerializedNodeAtPath(root: unknown, path: readonly number[]): SerializedNodeRecord | null {
  let current: unknown = root;
  for (const index of path) {
    if (!isSerializedNodeRecord(current) || !Array.isArray(current.children)) {
      return null;
    }
    current = current.children[index];
  }

  return isSerializedNodeRecord(current) ? current : null;
}

function plainParagraphTextCanMapDirectly(node: LexicalNode): boolean {
  if (!$isTextNode(node)) {
    return false;
  }

  const topLevel = node.getTopLevelElement();
  return (
    topLevel?.getType() === "paragraph"
    && node.getFormat() === 0
    && node.getStyle() === ""
  );
}

function findUniquePlainTextOffset(
  markdown: string,
  text: string,
  offset: number,
): number | null {
  if (text.length === 0) {
    return null;
  }

  const first = markdown.indexOf(text);
  if (first < 0) {
    return null;
  }

  if (markdown.indexOf(text, first + text.length) >= 0) {
    return null;
  }

  return first + Math.max(0, Math.min(offset, text.length));
}

function readExactTextOffsetWithMarker(
  editorState: EditorState,
  node: LexicalNode,
  offset: number,
): number | null {
  if (!$isTextNode(node)) {
    return null;
  }

  const path = getNodePathFromRoot(node);
  if (!path) {
    return null;
  }

  const serialized = JSON.parse(JSON.stringify(editorState.toJSON())) as ReturnType<EditorState["toJSON"]>;
  const serializedNode = getSerializedNodeAtPath(serialized.root, path);
  if (!serializedNode || typeof serializedNode.text !== "string") {
    return null;
  }

  const text = serializedNode.text;
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  serializedNode.text = `${text.slice(0, safeOffset)}${SOURCE_SELECTION_MARKER}${text.slice(safeOffset)}`;

  const markedMarkdown = exportMarkdownFromSerializedState(serialized);
  const markerIndex = markedMarkdown.indexOf(SOURCE_SELECTION_MARKER);
  return markerIndex >= 0 ? markerIndex : null;
}

function getBoundarySource(node: LexicalNode): string | null {
  if ($isLinkNode(node)) {
    return getLinkSource(node);
  }
  const reveal = getRevealSource(node);
  if (reveal) {
    return reveal.source;
  }
  if ($isTextNode(node)) {
    return getFormattedTextSource(node)?.source ?? node.getTextContent();
  }
  return null;
}

function getBoundarySourceNode(
  node: LexicalNode,
  boundary: "end" | "start",
): LexicalNode | null {
  const source = getBoundarySource(node);
  if (source !== null && source.length > 0) {
    return node;
  }
  if (!$isElementNode(node)) {
    return null;
  }

  const children = node.getChildren();
  const orderedChildren = boundary === "start" ? children : [...children].reverse();
  for (const child of orderedChildren) {
    const found = getBoundarySourceNode(child, boundary);
    if (found) {
      return found;
    }
  }
  return null;
}

function findBoundaryOffsetInMarkdown(
  markdown: string,
  target: LexicalNode,
  boundary: "end" | "start",
): number | null {
  let searchFrom = 0;
  let boundaryOffset: number | null = null;

  const visit = (node: LexicalNode): boolean => {
    const source = getBoundarySource(node);
    if (source !== null && source.length > 0) {
      const markdownIndex = markdown.indexOf(source, searchFrom);
      if (markdownIndex >= 0) {
        if (node.is(target)) {
          boundaryOffset = boundary === "end"
            ? markdownIndex + source.length
            : markdownIndex;
          return true;
        }
        searchFrom = markdownIndex + source.length;
        return false;
      }
    }

    if (!$isElementNode(node)) {
      return false;
    }
    return node.getChildren().some((child) => visit(child));
  };

  visit($getRoot());
  return boundaryOffset;
}

function readSourceOffsetFromElementBoundary(
  node: LexicalNode,
  offset: number,
  markdown: string | undefined,
): number | null {
  if (!markdown || !$isElementNode(node)) {
    return null;
  }

  const children = node.getChildren();
  if (offset > 0) {
    const previous = children[offset - 1];
    const target = previous ? getBoundarySourceNode(previous, "end") : null;
    if (target) {
      const sourceOffset = findBoundaryOffsetInMarkdown(markdown, target, "end");
      if (sourceOffset !== null) {
        return sourceOffset;
      }
    }
  }

  const next = children[offset];
  const target = next ? getBoundarySourceNode(next, "start") : null;
  return target ? findBoundaryOffsetInMarkdown(markdown, target, "start") : null;
}

function readSourceOffsetFromRangePoint(
  editor: LexicalEditor,
  editorState: EditorState,
  point: { readonly getNode: () => LexicalNode; readonly offset: number },
  options: SourceSelectionReadOptions,
): number | null {
  const node = point.getNode();
  if ($isTextNode(node)) {
    if (options.markdown && isRevealSourceStyle(node.getStyle())) {
      const revealOffset = findUniquePlainTextOffset(
        options.markdown,
        node.getTextContent(),
        point.offset,
      );
      if (revealOffset !== null) {
        return revealOffset;
      }
    }

    if (options.markdown && plainParagraphTextCanMapDirectly(node)) {
      const direct = findUniquePlainTextOffset(
        options.markdown,
        node.getTextContent(),
        point.offset,
      );
      if (direct !== null) {
        return direct;
      }
    }

    return readExactTextOffsetWithMarker(editorState, node, point.offset);
  }

  const boundaryOffset = readSourceOffsetFromElementBoundary(node, point.offset, options.markdown);
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

interface TextMarkerLocation {
  readonly offset: number;
  readonly path: readonly number[];
}

type LiveSourceLocation =
  | {
      readonly adapterId:
        | "footnote-reference"
        | "heading-attribute"
        | "inline-image"
        | "inline-math"
        | "link"
        | "raw-block"
        | "reference"
        | "text-format";
      readonly kind: "reveal";
      readonly node: LexicalNode;
      readonly offset: number;
      readonly source: string;
    }
  | {
      readonly kind: "text";
      readonly node: TextNode;
      readonly offset: number;
    };

function findTextMarkerLocationInState(
  markdown: string,
  offset: number,
): TextMarkerLocation | null {
  const safeOffset = Math.max(0, Math.min(offset, markdown.length));
  const markedMarkdown = [
    markdown.slice(0, safeOffset),
    SOURCE_NAVIGATION_MARKER,
    markdown.slice(safeOffset),
  ].join("");
  const probeEditor = createHeadlessCoflatEditor();
  setLexicalMarkdown(probeEditor, markedMarkdown);

  return probeEditor.getEditorState().read(() => {
    const visit = (node: LexicalNode, path: readonly number[]): TextMarkerLocation | null => {
      if ($isTextNode(node)) {
        const markerOffset = node.getTextContent().indexOf(SOURCE_NAVIGATION_MARKER);
        return markerOffset >= 0
          ? {
              offset: markerOffset,
              path,
            }
          : null;
      }

      const markerOffset = node.getTextContent().indexOf(SOURCE_NAVIGATION_MARKER);
      if (markerOffset >= 0 && !$isElementNode(node)) {
        return {
          offset: markerOffset,
          path,
        };
      }

      if (!$isElementNode(node)) {
        return null;
      }

      const children = node.getChildren();
      for (let index = 0; index < children.length; index += 1) {
        const found = visit(children[index], [...path, index]);
        if (found) {
          return found;
        }
      }

      return null;
    };

    return visit($getRoot(), []);
  });
}

function getNodeAtPath(path: readonly number[]): LexicalNode | null {
  let current: LexicalNode = $getRoot();
  for (const index of path) {
    if (!$isElementNode(current)) {
      return null;
    }
    const child = current.getChildren()[index];
    if (!child) {
      return null;
    }
    current = child;
  }
  return current;
}

function getRevealSource(
  node: LexicalNode,
): Pick<Extract<LiveSourceLocation, { kind: "reveal" }>, "adapterId" | "source"> | null {
  if ($isInlineMathNode(node)) {
    return { adapterId: "inline-math", source: node.getRaw() };
  }
  if ($isInlineImageNode(node)) {
    return { adapterId: "inline-image", source: node.getRaw() };
  }
  if ($isReferenceNode(node)) {
    return { adapterId: "reference", source: node.getRaw() };
  }
  if ($isFootnoteReferenceNode(node)) {
    return { adapterId: "footnote-reference", source: node.getRaw() };
  }
  if ($isHeadingAttributeNode(node)) {
    return { adapterId: "heading-attribute", source: node.getRaw() };
  }
  if ($isRawBlockNode(node)) {
    return { adapterId: "raw-block", source: node.getRaw() };
  }
  return null;
}

function getLinkSource(node: LinkNode): string {
  return `[${node.getTextContent()}](${node.getURL()})`;
}

function getFormattedTextSource(node: TextNode): {
  readonly closeLength: number;
  readonly openLength: number;
  readonly source: string;
} | null {
  const specs = getInlineTextFormatSpecs().filter((spec) => node.hasFormat(spec.lexicalFormat));
  if (specs.length === 0) {
    return null;
  }
  const open = specs.map((spec) => spec.markdownOpen).join("");
  const close = [...specs].reverse().map((spec) => spec.markdownClose).join("");
  return {
    closeLength: close.length,
    openLength: open.length,
    source: `${open}${node.getTextContent()}${close}`,
  };
}

function findTextLocationInElement(
  node: LexicalNode,
  visibleOffset: number,
): Extract<LiveSourceLocation, { kind: "text" }> | null {
  let remaining = Math.max(0, visibleOffset);
  let lastText: TextNode | null = null;

  const visit = (current: LexicalNode): Extract<LiveSourceLocation, { kind: "text" }> | null => {
    if ($isTextNode(current)) {
      lastText = current;
      const length = current.getTextContentSize();
      if (remaining <= length) {
        return {
          kind: "text",
          node: current,
          offset: remaining,
        };
      }
      remaining -= length;
      return null;
    }
    if (!$isElementNode(current)) {
      remaining -= current.getTextContent().length;
      return null;
    }
    for (const child of current.getChildren()) {
      const found = visit(child);
      if (found) {
        return found;
      }
    }
    return null;
  };

  const found = visit(node);
  if (found) {
    return found;
  }
  const fallbackText = lastText as TextNode | null;
  return fallbackText
    ? {
        kind: "text",
        node: fallbackText,
        offset: fallbackText.getTextContentSize(),
      }
    : null;
}

function findNearestLiveSourceLocation(
  markdown: string,
  offset: number,
): LiveSourceLocation | null {
  const targetOffset = Math.max(0, Math.min(offset, markdown.length));
  let searchFrom = 0;
  let previous: LiveSourceLocation | null = null;
  let nearest: LiveSourceLocation | null = null;

  const visit = (node: LexicalNode): boolean => {
    if ($isLinkNode(node)) {
      const source = getLinkSource(node);
      const markdownIndex = markdown.indexOf(source, searchFrom);
      if (source.length > 0 && markdownIndex >= 0) {
        const sourceEnd = markdownIndex + source.length;
        const labelStart = markdownIndex + 1;
        const labelEnd = labelStart + node.getTextContent().length;
        if (targetOffset <= markdownIndex) {
          nearest = {
            adapterId: "link",
            kind: "reveal",
            node,
            offset: 0,
            source,
          };
          return true;
        }
        if (targetOffset >= labelStart && targetOffset <= labelEnd) {
          const textLocation = findTextLocationInElement(node, targetOffset - labelStart);
          if (textLocation) {
            nearest = textLocation;
            return true;
          }
        }
        if (targetOffset <= sourceEnd) {
          nearest = {
            adapterId: "link",
            kind: "reveal",
            node,
            offset: targetOffset - markdownIndex,
            source,
          };
          return true;
        }
        previous = {
          adapterId: "link",
          kind: "reveal",
          node,
          offset: source.length,
          source,
        };
        searchFrom = sourceEnd;
        return false;
      }
    }

    const reveal = getRevealSource(node);
    const formattedText = $isTextNode(node) ? getFormattedTextSource(node) : null;
    const source = formattedText?.source ?? ($isTextNode(node) ? node.getTextContent() : reveal?.source ?? null);
    if (source !== null) {
      if (source.length === 0) {
        return false;
      }

      const markdownIndex = markdown.indexOf(source, searchFrom);
      if (markdownIndex < 0) {
        return false;
      }

      const sourceEnd = markdownIndex + source.length;
      const location = (sourceOffset: number): LiveSourceLocation => {
        if ($isTextNode(node) && formattedText) {
          const visibleStart = formattedText.openLength;
          const visibleEnd = source.length - formattedText.closeLength;
          if (sourceOffset < visibleStart || sourceOffset > visibleEnd) {
            return {
              adapterId: "text-format",
              kind: "reveal",
              node,
              offset: sourceOffset,
              source,
            };
          }
          return {
            kind: "text",
            node,
            offset: Math.max(0, Math.min(sourceOffset - visibleStart, node.getTextContentSize())),
          };
        }
        if ($isTextNode(node)) {
          return {
            kind: "text",
            node,
            offset: sourceOffset,
          };
        }
        if (!reveal) {
          throw new Error("Expected source-backed reveal metadata.");
        }
        return {
          adapterId: reveal.adapterId,
          kind: "reveal",
          node,
          offset: sourceOffset,
          source: reveal.source,
        };
      };
      if (targetOffset <= markdownIndex) {
        nearest = location(0);
        return true;
      }

      if (targetOffset <= sourceEnd) {
        nearest = location(targetOffset - markdownIndex);
        return true;
      }

      previous = location(source.length);
      searchFrom = sourceEnd;
      return false;
    }

    if (!$isElementNode(node)) {
      return false;
    }

    return node.getChildren().some((child) => visit(child));
  };

  visit($getRoot());
  return nearest ?? previous;
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
  location: Extract<LiveSourceLocation, { kind: "reveal" }>,
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

function createRevealRequestFromNode(
  node: LexicalNode,
  offset: number,
  options: SelectSourceOffsetsOptions,
): CursorRevealOpenRequest | null {
  const reveal = getRevealSource(node);
  if (!reveal) {
    return null;
  }
  return createRevealRequestFromSourceLocation({
    ...reveal,
    kind: "reveal",
    node,
    offset,
  }, options);
}

export function selectSourceOffsetsInRichLexicalRoot(
  editor: LexicalEditor,
  markdown: string,
  anchor: number,
  focus = anchor,
  options: SelectSourceOffsetsOptions = {},
): boolean {
  const anchorLocation = findTextMarkerLocationInState(markdown, anchor);
  const focusLocation = focus === anchor
    ? anchorLocation
    : findTextMarkerLocationInState(markdown, focus);

  let didSelect = false;
  let pendingRevealRequest: CursorRevealOpenRequest | null = null;
  editor.update(() => {
    const collapsed = anchor === focus;
    const directAnchorLocation = findNearestLiveSourceLocation(markdown, anchor);
    const directFocusLocation = collapsed
      ? directAnchorLocation
      : findNearestLiveSourceLocation(markdown, focus);
    const queueReveal = (request: CursorRevealOpenRequest | null): boolean => {
      if (!request) {
        return false;
      }
      pendingRevealRequest = request;
      didSelect = true;
      return true;
    };
    if (
      collapsed
      && directAnchorLocation?.kind === "reveal"
      && queueReveal(createRevealRequestFromSourceLocation(directAnchorLocation, options))
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

    if (!anchorLocation || !focusLocation) {
      return;
    }

    const anchorPathNode = getNodeAtPath(anchorLocation.path);
    const focusPathNode = getNodeAtPath(focusLocation.path);
    if (
      collapsed
      && anchorPathNode
      && queueReveal(createRevealRequestFromNode(anchorPathNode, anchorLocation.offset, options))
    ) {
      return;
    }
    const anchorLocationWithNode = $isTextNode(anchorPathNode)
      ? { node: anchorPathNode, offset: anchorLocation.offset }
      : null;
    const focusLocationWithNode = $isTextNode(focusPathNode)
      ? { node: focusPathNode, offset: focusLocation.offset }
      : null;
    if (!anchorLocationWithNode || !focusLocationWithNode) {
      return;
    }
    const { node: anchorNode, offset: anchorOffset } = anchorLocationWithNode;
    const { node: focusNode, offset: focusOffset } = focusLocationWithNode;

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
  }, { discrete: true });

  if (pendingRevealRequest) {
    editor.dispatchCommand(OPEN_CURSOR_REVEAL_COMMAND, pendingRevealRequest);
  }

  return didSelect;
}

export function readSourceSelectionFromLexicalSelection(
  editor: LexicalEditor,
  options: SourceSelectionReadOptions = {},
): MarkdownEditorSelection | null {
  const editorState = editor.getEditorState();

  return editorState.read(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchor = readSourceOffsetFromRangePoint(editor, editorState, selection.anchor, options);
      const focus = readSourceOffsetFromRangePoint(editor, editorState, selection.focus, options);
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
