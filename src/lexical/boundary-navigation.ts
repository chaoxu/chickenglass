import {
  $getNearestNodeFromDOMNode,
  $getRoot,
  $isDecoratorNode,
  type LexicalEditor,
  type NodeKey,
} from "lexical";

export type BoundaryDirection = "backward" | "forward";

export function hasNavigationModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

export function directionFromHorizontalArrowKey(key: string): BoundaryDirection | null {
  if (key === "ArrowRight") {
    return "forward";
  }
  if (key === "ArrowLeft") {
    return "backward";
  }
  return null;
}

function rootChildContaining(root: HTMLElement, node: Node | null): HTMLElement | null {
  let current = node instanceof Element ? node : node?.parentElement ?? null;
  while (current && current.parentElement !== root) {
    current = current.parentElement;
  }
  return current instanceof HTMLElement && current.parentElement === root ? current : null;
}

function isDomSelectionAtEdge(rootChild: HTMLElement, isBackward: boolean): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.anchorNode) {
    return false;
  }

  try {
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(rootChild);
    beforeRange.setEnd(selection.anchorNode, selection.anchorOffset);
    const beforeLength = beforeRange.toString().length;
    const totalLength = rootChild.textContent?.length ?? 0;
    return isBackward ? beforeLength === 0 : beforeLength === totalLength;
  } catch {
    return false;
  }
}

function isIgnorableEmptyRootBlock(element: Element): boolean {
  return element.classList.contains("cf-lexical-paragraph")
    && (element.textContent ?? "").trim().length === 0;
}

function adjacentNonEmptyRootSibling(
  rootChild: HTMLElement,
  direction: BoundaryDirection,
): HTMLElement | null {
  let sibling: Element | null = direction === "forward"
    ? rootChild.nextElementSibling
    : rootChild.previousElementSibling;
  while (sibling && isIgnorableEmptyRootBlock(sibling)) {
    sibling = direction === "forward"
      ? sibling.nextElementSibling
      : sibling.previousElementSibling;
  }
  return sibling instanceof HTMLElement ? sibling : null;
}

function findDecoratorKeyForElement(
  editor: LexicalEditor,
  element: HTMLElement,
): NodeKey | null {
  let key: NodeKey | null = null;
  editor.read(() => {
    const nearestNode = $getNearestNodeFromDOMNode(element);
    if ($isDecoratorNode(nearestNode)) {
      key = nearestNode.getKey();
      return;
    }

    for (const child of $getRoot().getChildren()) {
      if (!$isDecoratorNode(child)) {
        continue;
      }
      const childElement = editor.getElementByKey(child.getKey());
      if (
        childElement instanceof HTMLElement
        && (childElement === element || childElement.contains(element) || element.contains(childElement))
      ) {
        key = child.getKey();
        return;
      }
    }
  });
  return key;
}

export function findAdjacentTopLevelDecoratorKeyFromDomBoundary(
  editor: LexicalEditor,
  direction: BoundaryDirection,
): NodeKey | null {
  const root = editor.getRootElement();
  const selection = window.getSelection();
  if (!root || !selection?.anchorNode || !root.contains(selection.anchorNode)) {
    return null;
  }

  const rootChild = rootChildContaining(root, selection.anchorNode);
  if (!rootChild || !isDomSelectionAtEdge(rootChild, direction === "backward")) {
    return null;
  }

  const sibling = adjacentNonEmptyRootSibling(rootChild, direction);
  if (!sibling) {
    return null;
  }
  return findDecoratorKeyForElement(editor, sibling);
}

function lexicalTextBoundaryNode(node: Node): Node {
  const parent = node.parentElement;
  return parent?.hasAttribute("data-lexical-text") ? parent : node;
}

function isIgnorableDomBoundaryNode(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").length === 0;
}

function firstMeaningfulNode(
  node: Node | null,
  direction: BoundaryDirection,
): Node | null {
  let current = node;
  while (current && isIgnorableDomBoundaryNode(current)) {
    current = direction === "forward"
      ? current.nextSibling
      : current.previousSibling;
  }
  return current;
}

function nextMeaningfulSibling(node: Node): Node | null {
  return firstMeaningfulNode(node.nextSibling, "forward");
}

function previousMeaningfulSibling(node: Node): Node | null {
  return firstMeaningfulNode(node.previousSibling, "backward");
}

function adjacentDomBoundaryNode(
  anchorNode: Node,
  anchorOffset: number,
  direction: BoundaryDirection,
): Node | null {
  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? "";
    const boundaryNode = lexicalTextBoundaryNode(anchorNode);
    if (direction === "forward") {
      return anchorOffset === text.length ? nextMeaningfulSibling(boundaryNode) : null;
    }
    return anchorOffset === 0 ? previousMeaningfulSibling(boundaryNode) : null;
  }

  if (!(anchorNode instanceof Element)) {
    return null;
  }

  if (direction === "forward") {
    return anchorOffset < anchorNode.childNodes.length
      ? firstMeaningfulNode(anchorNode.childNodes[anchorOffset] ?? null, direction)
      : nextMeaningfulSibling(anchorNode);
  }
  return anchorOffset > 0
    ? firstMeaningfulNode(anchorNode.childNodes[anchorOffset - 1] ?? null, direction)
    : previousMeaningfulSibling(anchorNode);
}

function decoratorElementFromCandidate(node: Node | null): HTMLElement | null {
  if (!(node instanceof Element)) {
    return null;
  }
  const decorator = node.matches("[data-lexical-decorator='true']")
    ? node
    : node.closest("[data-lexical-decorator='true']");
  return decorator instanceof HTMLElement ? decorator : null;
}

export function findAdjacentInlineDecoratorElementFromDomSelection(
  root: HTMLElement,
  direction: BoundaryDirection,
): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed || !selection.anchorNode || !root.contains(selection.anchorNode)) {
    return null;
  }

  const candidate = adjacentDomBoundaryNode(
    selection.anchorNode,
    selection.anchorOffset,
    direction,
  );
  return decoratorElementFromCandidate(candidate);
}
