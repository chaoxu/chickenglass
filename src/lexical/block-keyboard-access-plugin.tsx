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
  directionFromHorizontalArrowKey,
  findAdjacentTopLevelDecoratorKeyFromDomBoundary,
  hasNavigationModifier,
  type BoundaryDirection,
} from "./boundary-navigation";
import { queueEmbeddedSurfaceFocus } from "./pending-surface-focus";
import { enterBlockSurfaceTarget } from "./surface-activation";

function $selectDecoratorTarget(nodeKey: NodeKey): void {
  const node = $getNodeByKey(nodeKey);
  if (!$isDecoratorNode(node)) {
    return;
  }
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
}

function selectDecoratorTarget(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  inLexicalCommand: boolean,
): void {
  if (inLexicalCommand) {
    $selectDecoratorTarget(nodeKey);
    return;
  }
  editor.update(() => {
    $selectDecoratorTarget(nodeKey);
  }, { discrete: true });
}

function handleDecoratorArrowNavigation(
  editor: LexicalEditor,
  event: KeyboardEvent,
  direction: BoundaryDirection,
  options: {
    readonly inLexicalCommand: boolean;
    readonly requireBlockEdge: boolean;
  },
): boolean {
  if (hasNavigationModifier(event)) {
    return false;
  }

  const lexicalTargetKey = editor.read(() => {
    if (options.requireBlockEdge && !$isAtTopLevelBlockEdge(direction === "backward")) {
      return null;
    }
    return $findAdjacentTopLevelSiblingFromSelection(direction, $isDecoratorNode)?.getKey() ?? null;
  });
  const targetKey = lexicalTargetKey
    ?? (options.requireBlockEdge
      ? findAdjacentTopLevelDecoratorKeyFromDomBoundary(editor, direction)
      : null);
  if (!targetKey) {
    return false;
  }

  const target = editor.getElementByKey(targetKey);
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  selectDecoratorTarget(editor, targetKey, options.inLexicalCommand);
  queueEmbeddedSurfaceFocus(
    editor.getKey(),
    targetKey,
    "structure-source",
    direction === "forward" ? "start" : "end",
  );
  return enterBlockSurfaceTarget(target, direction);
}

function registerDecoratorArrowNavigation(
  editor: LexicalEditor,
  command: LexicalCommand<KeyboardEvent | null>,
  direction: BoundaryDirection,
  options: { readonly requireBlockEdge: boolean },
): () => void {
  return editor.registerCommand(
    command,
    (event) => {
      if (!event) {
        return false;
      }
      return handleDecoratorArrowNavigation(editor, event, direction, {
        ...options,
        inLexicalCommand: true,
      });
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
    const direction = directionFromHorizontalArrowKey(event.key);
    if (!direction) {
      return;
    }
    handleDecoratorArrowNavigation(editor, event, direction, {
      inLexicalCommand: false,
      requireBlockEdge: true,
    });
  };

  return editor.registerRootListener((rootElement, previousRootElement) => {
    previousRootElement?.removeEventListener("keydown", onKeyDown, true);
    if (!rootElement) {
      return;
    }
    rootElement.addEventListener("keydown", onKeyDown, true);
    return () => {
      rootElement.removeEventListener("keydown", onKeyDown, true);
    };
  });
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
