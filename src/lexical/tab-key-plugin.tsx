import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, type ListItemNode } from "@lexical/list";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  KEY_TAB_COMMAND,
  type LexicalNode,
} from "lexical";

function $findEnclosingListItem(node: LexicalNode): ListItemNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isListItemNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}

/**
 * Handles a `KEY_TAB_COMMAND` dispatch. Always prevents the default
 * browser behavior so Tab cannot move focus out of the contenteditable.
 * Inside a list item, Tab/Shift+Tab adjusts the item's indent so nesting
 * persists through the markdown round-trip. Elsewhere Tab is a no-op.
 */
export function $handleTabKeyCommand(event: KeyboardEvent): boolean {
  event.preventDefault();

  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return true;
  }

  const listItem = $findEnclosingListItem(selection.anchor.getNode());
  if (!listItem) {
    return true;
  }

  const indent = listItem.getIndent();
  if (event.shiftKey) {
    if (indent > 0) {
      listItem.setIndent(indent - 1);
    }
    return true;
  }

  listItem.setIndent(indent + 1);
  return true;
}

export function TabKeyPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (!event) {
            return false;
          }
          return $handleTabKeyCommand(event);
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  );

  return null;
}
