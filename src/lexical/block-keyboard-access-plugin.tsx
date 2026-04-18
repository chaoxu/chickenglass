import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createNodeSelection,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ARROW_UP_COMMAND,
  mergeRegister,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import {
  $findAdjacentTopLevelSiblingFromSelection,
  $isAtTopLevelBlockEdge,
} from "./selection-boundary";
import {
  BLOCK_KEYBOARD_ACTIVATION_SELECTOR,
  BLOCK_KEYBOARD_PRIMARY_ENTRY_SELECTOR,
} from "./block-keyboard-entry";
import { requestRegisteredSurfaceFocus } from "./editor-focus-plugin";
import { queueEmbeddedSurfaceFocus } from "./pending-surface-focus";

type NavigationDirection = "forward" | "backward";

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
  direction: NavigationDirection,
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

function findAdjacentDecoratorKeyFromDomBoundary(
  editor: LexicalEditor,
  direction: NavigationDirection,
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

function queryEditableTargets(target: HTMLElement): HTMLElement[] {
  const primaryEntries = [...target.querySelectorAll<HTMLElement>(
    `${BLOCK_KEYBOARD_PRIMARY_ENTRY_SELECTOR} [contenteditable='true']`,
  )];
  if (primaryEntries.length > 0) {
    return primaryEntries;
  }

  return [...target.querySelectorAll<HTMLElement>("[contenteditable='true']")];
}

function activateNestedEditor(
  editable: HTMLElement,
  direction: NavigationDirection,
): boolean {
  return requestRegisteredSurfaceFocus(
    editable,
    direction === "forward" ? "start" : "end",
  );
}

function focusTarget(
  target: HTMLElement,
  direction: NavigationDirection,
): boolean {
  const editableTargets = queryEditableTargets(target)
    .filter((element) => !element.classList.contains("cf-lexical-editor--hidden"));

  const editable = direction === "forward"
    ? editableTargets[0]
    : editableTargets[editableTargets.length - 1];
  if (editable && activateNestedEditor(editable, direction)) {
    return true;
  }

  const focusableTargets = [...target.querySelectorAll<HTMLElement>(
    "button, [role='button'], a[href], [tabindex]:not([tabindex='-1'])",
  )];
  const focusable = direction === "forward"
    ? focusableTargets[0]
    : focusableTargets[focusableTargets.length - 1];
  if (focusable) {
    focusable.focus();
    return true;
  }

  return false;
}

function enterDecoratorTarget(
  target: HTMLElement,
  direction: NavigationDirection,
): boolean {
  const activationTarget = target.querySelector<HTMLElement>(BLOCK_KEYBOARD_ACTIVATION_SELECTOR);
  if (activationTarget) {
    activationTarget.focus();
    activationTarget.click();
    return true;
  }

  requestAnimationFrame(() => {
    focusTarget(target, direction);
  });
  return focusTarget(target, direction);
}

function selectDecoratorTarget(editor: LexicalEditor, nodeKey: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (!$isDecoratorNode(node)) {
      return;
    }
    const selection = $createNodeSelection();
    selection.add(node.getKey());
    $setSelection(selection);
  }, { discrete: true });
}

function handleDecoratorArrowNavigation(
  editor: LexicalEditor,
  event: KeyboardEvent,
  direction: NavigationDirection,
  options: { readonly requireBlockEdge: boolean },
): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  const lexicalTargetKey = editor.read(() => {
    if (options.requireBlockEdge && !$isAtTopLevelBlockEdge(direction === "backward")) {
      return null;
    }
    return $findAdjacentTopLevelSiblingFromSelection(direction, $isDecoratorNode)?.getKey() ?? null;
  });
  const targetKey = lexicalTargetKey
    ?? (options.requireBlockEdge ? findAdjacentDecoratorKeyFromDomBoundary(editor, direction) : null);
  if (!targetKey) {
    return false;
  }

  const target = editor.getElementByKey(targetKey);
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  selectDecoratorTarget(editor, targetKey);
  queueEmbeddedSurfaceFocus(
    editor.getKey(),
    targetKey,
    "structure-source",
    direction === "forward" ? "start" : "end",
  );
  return enterDecoratorTarget(target, direction);
}

function registerDecoratorArrowNavigation(
  editor: LexicalEditor,
  command: LexicalCommand<KeyboardEvent | null>,
  direction: NavigationDirection,
  options: { readonly requireBlockEdge: boolean },
): () => void {
  return editor.registerCommand(
    command,
    (event) => {
      if (!event) {
        return false;
      }
      return handleDecoratorArrowNavigation(editor, event, direction, options);
    },
    COMMAND_PRIORITY_HIGH,
  );
}

function registerDomHorizontalArrowNavigation(editor: LexicalEditor): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const rootElement = editor.getRootElement();
    if (!rootElement) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[contenteditable='true']") !== rootElement) {
      return;
    }
    if (event.key === "ArrowRight") {
      handleDecoratorArrowNavigation(editor, event, "forward", { requireBlockEdge: true });
      return;
    }
    if (event.key === "ArrowLeft") {
      handleDecoratorArrowNavigation(editor, event, "backward", { requireBlockEdge: true });
    }
  };

  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
  };
}

function registerDecoratorDeletionCommand(
  editor: LexicalEditor,
  command: LexicalCommand<KeyboardEvent | null>,
): () => void {
  return editor.registerCommand(
    command,
    (event) => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) {
        return false;
      }

      const nodes = selection.getNodes().filter($isDecoratorNode);
      if (nodes.length === 0) {
        return false;
      }

      event?.preventDefault();
      editor.update(() => {
        for (const node of nodes) {
          node.remove();
        }
        const root = $getRoot();
        if (root.getChildrenSize() === 0) {
          const paragraph = $createParagraphNode();
          root.append(paragraph);
          paragraph.selectStart();
        }
      }, { discrete: true });
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
}

export function BlockKeyboardAccessPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => mergeRegister(
    registerDomHorizontalArrowNavigation(editor),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_DOWN_COMMAND, "forward", { requireBlockEdge: false }),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_UP_COMMAND, "backward", { requireBlockEdge: false }),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_RIGHT_COMMAND, "forward", { requireBlockEdge: true }),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_LEFT_COMMAND, "backward", { requireBlockEdge: true }),
    registerDecoratorDeletionCommand(editor, KEY_BACKSPACE_COMMAND),
    registerDecoratorDeletionCommand(editor, KEY_DELETE_COMMAND),
  ), [editor]);

  return null;
}
