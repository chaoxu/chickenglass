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
import { requestRegisteredSurfaceFocus } from "./editor-focus-plugin";
import { queueEmbeddedSurfaceFocus } from "./pending-surface-focus";

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

function registerDecoratorArrowNavigation(
  editor: LexicalEditor,
  command: LexicalCommand<KeyboardEvent | null>,
  direction: NavigationDirection,
  options: { readonly requireBlockEdge: boolean },
): () => void {
  return editor.registerCommand(
    command,
    (event) => {
      if (!event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return false;
      }

      const targetKey = editor.getEditorState().read(() => {
        if (options.requireBlockEdge && !$isAtTopLevelBlockEdge(direction === "backward")) {
          return null;
        }
        return $findAdjacentTopLevelSiblingFromSelection(direction, $isDecoratorNode)?.getKey() ?? null;
      });
      if (!targetKey) {
        return false;
      }

      const target = editor.getElementByKey(targetKey);
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      event.preventDefault();
      selectDecoratorTarget(editor, targetKey);
      queueEmbeddedSurfaceFocus(
        editor.getKey(),
        targetKey,
        "structure-source",
        direction === "forward" ? "start" : "end",
      );
      return enterDecoratorTarget(target, direction);
    },
    COMMAND_PRIORITY_LOW,
  );
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
    registerDecoratorArrowNavigation(editor, KEY_ARROW_DOWN_COMMAND, "forward", { requireBlockEdge: false }),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_UP_COMMAND, "backward", { requireBlockEdge: false }),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_RIGHT_COMMAND, "forward", { requireBlockEdge: true }),
    registerDecoratorArrowNavigation(editor, KEY_ARROW_LEFT_COMMAND, "backward", { requireBlockEdge: true }),
    registerDecoratorDeletionCommand(editor, KEY_BACKSPACE_COMMAND),
    registerDecoratorDeletionCommand(editor, KEY_DELETE_COMMAND),
  ), [editor]);

  return null;
}
