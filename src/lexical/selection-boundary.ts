import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalNode,
} from "lexical";

type NodePredicate<T extends LexicalNode> = (
  node: LexicalNode | null | undefined,
) => node is T;

function findBoundarySibling(
  startNode: LexicalNode,
  isBackward: boolean,
): LexicalNode | null {
  let current: LexicalNode | null = startNode;
  while (current) {
    const sibling = isBackward ? current.getPreviousSibling() : current.getNextSibling();
    if (sibling) {
      return sibling;
    }
    current = current.getParent();
  }
  return null;
}

function findMatchingNodeInSubtree<T extends LexicalNode>(
  node: LexicalNode | null,
  isBackward: boolean,
  predicate: NodePredicate<T>,
): T | null {
  if (!node) {
    return null;
  }

  if (predicate(node)) {
    return node;
  }

  if (!$isElementNode(node)) {
    return null;
  }

  const children = node.getChildren();
  if (isBackward) {
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const match = findMatchingNodeInSubtree(children[index], isBackward, predicate);
      if (match) {
        return match;
      }
    }
    return null;
  }

  for (const child of children) {
    const match = findMatchingNodeInSubtree(child, isBackward, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

export function $findAdjacentNodeAtSelectionBoundary<T extends LexicalNode>(
  isBackward: boolean,
  predicate: NodePredicate<T>,
): T | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }

  const anchorNode = selection.anchor.getNode();
  if (selection.anchor.type === "text") {
    if (!$isTextNode(anchorNode)) {
      return null;
    }

    const textLength = anchorNode.getTextContentSize();
    if ((isBackward && selection.anchor.offset !== 0) || (!isBackward && selection.anchor.offset !== textLength)) {
      return null;
    }

    return findMatchingNodeInSubtree(
      findBoundarySibling(anchorNode, isBackward),
      isBackward,
      predicate,
    );
  }

  if (!$isElementNode(anchorNode)) {
    return null;
  }

  const childIndex = isBackward ? selection.anchor.offset - 1 : selection.anchor.offset;
  if (childIndex >= 0 && childIndex < anchorNode.getChildrenSize()) {
    return findMatchingNodeInSubtree(
      anchorNode.getChildAtIndex(childIndex),
      isBackward,
      predicate,
    );
  }

  return findMatchingNodeInSubtree(
    findBoundarySibling(anchorNode, isBackward),
    isBackward,
    predicate,
  );
}

export function $isAtTopLevelBlockEdge(isBackward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const anchorNode = selection.anchor.getNode();
  const topBlock = anchorNode.getTopLevelElement();
  if (!topBlock) {
    return false;
  }

  if (selection.anchor.type === "text") {
    if (!$isTextNode(anchorNode)) {
      return false;
    }
    const edgeOffset = isBackward ? 0 : anchorNode.getTextContentSize();
    if (selection.anchor.offset !== edgeOffset) {
      return false;
    }
  } else if ($isElementNode(anchorNode)) {
    const edgeOffset = isBackward ? 0 : anchorNode.getChildrenSize();
    if (selection.anchor.offset !== edgeOffset) {
      return false;
    }
  } else {
    return false;
  }

  let current: LexicalNode = anchorNode;
  while (current !== topBlock) {
    const sibling = isBackward ? current.getPreviousSibling() : current.getNextSibling();
    if (sibling) {
      return false;
    }
    const parent: LexicalNode | null = current.getParent();
    if (!parent) {
      return false;
    }
    current = parent;
  }
  return true;
}

export function $findAdjacentTopLevelSiblingFromSelection<T extends LexicalNode>(
  direction: "forward" | "backward",
  predicate: NodePredicate<T>,
): T | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null;
  }

  const currentBlock = selection.anchor.getNode().getTopLevelElement();
  if (!currentBlock) {
    return null;
  }

  const sibling = direction === "forward"
    ? currentBlock.getNextSibling()
    : currentBlock.getPreviousSibling();
  return predicate(sibling) ? sibling : null;
}
