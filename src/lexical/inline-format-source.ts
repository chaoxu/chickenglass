import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $parseSerializedNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type TextNode,
} from "lexical";

import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  setLexicalMarkdown,
} from "./markdown";

export type EntrySide = "start" | "end";
export type ExitDirection = "before" | "after";

export interface InlineFormatSegment {
  readonly nodeKeys: readonly NodeKey[];
  readonly primaryKey: NodeKey;
  readonly serializedNodes: readonly SerializedLexicalNode[];
}

function hasEditableInlineFormat(node: TextNode): boolean {
  return node.hasFormat("bold")
    || node.hasFormat("italic")
    || node.hasFormat("strikethrough")
    || node.hasFormat("highlight")
    || node.hasFormat("code");
}

function hasLinkAncestor(node: LexicalNode): boolean {
  let current = node.getParent();
  while (current) {
    if (current.getType() === "link" || current.getType() === "autolink") {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

export function isEditableInlineFormatNode(
  node: LexicalNode | null | undefined,
): node is TextNode {
  return $isTextNode(node)
    && node.getTextContentSize() > 0
    && hasEditableInlineFormat(node)
    && !hasLinkAncestor(node);
}

function shareFormattingSignature(left: TextNode, right: TextNode): boolean {
  return left.getFormat() === right.getFormat()
    && left.getStyle() === right.getStyle()
    && left.getMode() === right.getMode();
}

export function collectInlineFormatSegment(node: TextNode): InlineFormatSegment | null {
  if (!isEditableInlineFormatNode(node)) {
    return null;
  }

  const segmentNodes: TextNode[] = [node];

  let previous = node.getPreviousSibling();
  while (isEditableInlineFormatNode(previous) && shareFormattingSignature(node, previous)) {
    segmentNodes.unshift(previous);
    previous = previous.getPreviousSibling();
  }

  let next = node.getNextSibling();
  while (isEditableInlineFormatNode(next) && shareFormattingSignature(node, next)) {
    segmentNodes.push(next);
    next = next.getNextSibling();
  }

  return {
    nodeKeys: segmentNodes.map((segmentNode) => segmentNode.getKey()),
    primaryKey: segmentNodes[0].getKey(),
    serializedNodes: segmentNodes.map((segmentNode) => segmentNode.exportJSON()),
  };
}

export function serializeInlineFormatSegment(
  serializedNodes: readonly SerializedLexicalNode[],
): string {
  const editor = createHeadlessCoflatEditor();
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    for (const serializedNode of serializedNodes) {
      paragraph.append($parseSerializedNode(serializedNode));
    }
    root.append(paragraph);
  }, { discrete: true });
  return getLexicalMarkdown(editor);
}

export function parseInlineFormatSource(raw: string): readonly SerializedLexicalNode[] {
  const editor = createHeadlessCoflatEditor();
  setLexicalMarkdown(editor, raw);
  return editor.getEditorState().read(() => {
    const root = $getRoot();
    if (root.getChildrenSize() !== 1) {
      return [$createTextNode(raw).exportJSON()];
    }
    const firstChild = root.getFirstChild();
    if (!$isElementNode(firstChild) || firstChild.getType() !== "paragraph") {
      return [$createTextNode(raw).exportJSON()];
    }
    const children = firstChild.getChildren();
    if (children.length === 0) {
      return [$createTextNode("").exportJSON()];
    }
    return children.map((child) => child.exportJSON());
  });
}

export function selectOutsideSiblingRange(
  firstNode: LexicalNode,
  lastNode: LexicalNode,
  direction: ExitDirection,
): void {
  if (direction === "before") {
    const placeholder = $createTextNode("");
    firstNode.insertBefore(placeholder, false);
    placeholder.select(0, 0);
    return;
  }

  const placeholder = $createTextNode("");
  lastNode.insertAfter(placeholder, false);
  placeholder.select(0, 0);
}
