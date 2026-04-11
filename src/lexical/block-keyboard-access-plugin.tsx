import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ARROW_UP_COMMAND,
  mergeRegister,
  type NodeKey,
} from "lexical";
import { $findAdjacentTopLevelSiblingFromSelection } from "./selection-boundary";
import { requestRegisteredSurfaceFocus } from "./editor-focus-plugin";

type NavigationDirection = "forward" | "backward";

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
  const displayMathActivator = target.querySelector<HTMLElement>(
    ".cf-lexical-display-math-body, .cf-lexical-display-math-label",
  );
  if (displayMathActivator) {
    displayMathActivator.focus();
    displayMathActivator.click();
    return true;
  }

  requestAnimationFrame(() => {
    focusTarget(target, direction);
  });
  return focusTarget(target, direction);
}

export function BlockKeyboardAccessPlugin() {
  const [editor] = useLexicalComposerContext();

  const selectDecoratorTarget = (nodeKey: NodeKey) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
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
        if (!event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return false;
        }

        const targetKey = editor.getEditorState().read(() =>
          $findAdjacentTopLevelSiblingFromSelection("forward", $isDecoratorNode)?.getKey() ?? null
        );
        if (!targetKey) {
          return false;
        }

        const target = editor.getElementByKey(targetKey);
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        event.preventDefault();
        selectDecoratorTarget(targetKey);
        return enterDecoratorTarget(target, "forward");
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return false;
        }

        const targetKey = editor.getEditorState().read(() =>
          $findAdjacentTopLevelSiblingFromSelection("backward", $isDecoratorNode)?.getKey() ?? null
        );
        if (!targetKey) {
          return false;
        }

        const target = editor.getElementByKey(targetKey);
        if (!(target instanceof HTMLElement)) {
          return false;
        }

        event.preventDefault();
        selectDecoratorTarget(targetKey);
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
