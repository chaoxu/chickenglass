import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
  type TextNode,
} from "lexical";

export type VisibleTextAffinity = "backward" | "forward";

export interface VisibleTextLocation {
  readonly node: TextNode;
  readonly offset: number;
}

function clampOffset(offset: number, length: number): number {
  return Math.max(0, Math.min(offset, length));
}

function visibleTextLength(node: LexicalNode): number {
  return $isTextNode(node)
    ? node.getTextContentSize()
    : node.getTextContent().length;
}

function visibleOffsetAtNodeBoundary(
  node: LexicalNode,
  offset: number,
): number {
  if ($isTextNode(node)) {
    return clampOffset(offset, node.getTextContentSize());
  }
  if (!$isElementNode(node)) {
    return clampOffset(offset, node.getTextContent().length);
  }

  const children = node.getChildren();
  const childCount = clampOffset(offset, children.length);
  return children
    .slice(0, childCount)
    .reduce((total, child) => total + visibleTextLength(child), 0);
}

export function $getVisibleTextLength(root: LexicalNode = $getRoot()): number {
  return visibleTextLength(root);
}

export function $getVisibleTextOffset(
  root: LexicalNode,
  anchorNode: LexicalNode,
  anchorOffset: number,
): number {
  let visible = 0;
  let found = false;

  const walk = (node: LexicalNode): void => {
    if (found) {
      return;
    }
    if (node === anchorNode) {
      visible += visibleOffsetAtNodeBoundary(node, anchorOffset);
      found = true;
      return;
    }
    if ($isTextNode(node)) {
      visible += node.getTextContentSize();
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
        if (found) {
          return;
        }
      }
      return;
    }
    visible += node.getTextContent().length;
  };

  walk(root);
  return visible;
}

export function $findVisibleTextLocation(
  root: LexicalNode,
  visibleOffset: number,
  affinity: VisibleTextAffinity = "forward",
): VisibleTextLocation | null {
  let remaining = Math.max(0, visibleOffset);
  let lastTextNode: TextNode | null = null;

  const visit = (node: LexicalNode): VisibleTextLocation | null => {
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

  const location = visit(root);
  if (location) {
    return location;
  }
  if (lastTextNode === null) {
    return null;
  }
  const node = lastTextNode as TextNode;
  return { node, offset: node.getTextContentSize() };
}
