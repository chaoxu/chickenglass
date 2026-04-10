import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createNodeSelection,
  $getRoot,
  $getSelection,
  $getNearestNodeFromDOMNode,
  $isDecoratorNode,
  $isNodeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ARROW_UP_COMMAND,
  mergeRegister,
} from "lexical";

type NavigationDirection = "forward" | "backward";

function closestTopLevelChild(rootElement: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current && current.parentNode !== rootElement) {
    current = current.parentNode;
  }
  return current instanceof HTMLElement ? current : null;
}

function findAdjacentDecorator(
  rootElement: HTMLElement,
  direction: NavigationDirection,
): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || !selection.isCollapsed) {
    return null;
  }

  const anchorNode = selection.anchorNode;
  if (!anchorNode || !rootElement.contains(anchorNode)) {
    return null;
  }

  const currentBlock = closestTopLevelChild(rootElement, anchorNode);
  if (!currentBlock) {
    return null;
  }

  const sibling = direction === "forward"
    ? currentBlock.nextSibling
    : currentBlock.previousSibling;

  return sibling instanceof HTMLElement && sibling.dataset.lexicalDecorator === "true"
    ? sibling
    : null;
}

function queryEditableTargets(target: HTMLElement): HTMLElement[] {
  const bodyCells = [...target.querySelectorAll<HTMLElement>(
    ".cf-lexical-table-block tbody [contenteditable='true']",
  )];
  if (bodyCells.length > 0) {
    return bodyCells;
  }

  return [...target.querySelectorAll<HTMLElement>("[contenteditable='true']")];
}

function activateNestedEditor(
  editable: HTMLElement,
  _direction: NavigationDirection,
): void {
  const shell = editable.closest<HTMLElement>(".cf-lexical-nested-editor") ?? editable;
  for (const type of ["mousedown", "mouseup", "click"]) {
    shell.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }
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
  if (editable) {
    activateNestedEditor(editable, direction);
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
  const displayMathActivator = target.querySelector<HTMLElement>(
    ".cf-lexical-display-math-body, .cf-lexical-display-math-label",
  );
  if (displayMathActivator) {
    displayMathActivator.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    return true;
  }

  requestAnimationFrame(() => {
    focusTarget(target, direction);
  });
  return focusTarget(target, direction);
}

export function BlockKeyboardAccessPlugin() {
  const [editor] = useLexicalComposerContext();

  const selectDecoratorTarget = (target: HTMLElement) => {
    editor.update(() => {
      const node = $getNearestNodeFromDOMNode(target);
      if (!$isDecoratorNode(node)) {
        return;
      }
      const selection = $createNodeSelection();
      selection.add(node.getKey());
      $setSelection(selection);
    }, { discrete: true });
  };

  useEffect(() => mergeRegister(
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        const rootElement = editor.getRootElement();
        if (!rootElement || !event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return false;
        }

        const target = findAdjacentDecorator(rootElement, "forward");
        if (!target) {
          return false;
        }

        event.preventDefault();
        selectDecoratorTarget(target);
        return enterDecoratorTarget(target, "forward");
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        const rootElement = editor.getRootElement();
        if (!rootElement || !event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return false;
        }

        const target = findAdjacentDecorator(rootElement, "backward");
        if (!target) {
          return false;
        }

        event.preventDefault();
        selectDecoratorTarget(target);
        return enterDecoratorTarget(target, "backward");
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
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
    ),
    editor.registerCommand(
      KEY_DELETE_COMMAND,
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
    ),
  ), [editor]);

  return null;
}
