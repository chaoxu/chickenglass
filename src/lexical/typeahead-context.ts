import { $isCodeNode } from "@lexical/code";
import { $getSelection, $isRangeSelection, type LexicalNode } from "lexical";

export function $isForbiddenTypeaheadContext(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return true;
  }

  if (selection.hasFormat("code")) {
    return true;
  }

  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if ($isCodeNode(node)) {
      return true;
    }
    node = node.getParent();
  }

  return false;
}
