import {
  $createParagraphNode,
  $getNodeByKey,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";

import { $isTableCellNode } from "./nodes/table-cell-node";
import { $isTableNode } from "./nodes/table-node";
import { $isTableRowNode } from "./nodes/table-row-node";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";

export type InsertFocusTarget =
  | "block-body"
  | "display-math"
  | "footnote-body"
  | "frontmatter"
  | "include-path"
  | "none"
  | "table-cell";

const FOCUS_SELECTORS: Partial<Record<InsertFocusTarget, string>> = {
  "display-math": ".cf-lexical-display-math-body",
  "frontmatter": ".cf-lexical-structure-toggle--frontmatter",
  "include-path": ".cf-lexical-structure-toggle--include",
};

export function ensureTrailingParagraph(insertedNode: LexicalNode, afterNode?: LexicalNode | null): void {
  if (afterNode ?? insertedNode.getNextSibling()) {
    return;
  }
  insertedNode.insertAfter($createParagraphNode());
}

export function focusFirstTableCell(editor: LexicalEditor, key: NodeKey): void {
  editor.update(() => {
    const node = $getNodeByKey(key);
    if (!$isTableNode(node)) {
      return;
    }

    const rowNodes = node.getChildren().filter($isTableRowNode);
    const targetRow = rowNodes[1] ?? rowNodes[0] ?? null;
    const targetCell = targetRow
      ?.getChildren()
      .find($isTableCellNode);

    if (!targetCell) {
      return;
    }

    const firstChild = targetCell.getFirstChild();
    if ($isElementNode(firstChild)) {
      firstChild.selectStart();
      return;
    }

    targetCell.selectStart();
  }, {
    discrete: true,
    tag: COFLAT_NESTED_EDIT_TAG,
  });
  editor.focus();
}

export function activateInsertedBlock(editor: LexicalEditor, key: NodeKey, focusTarget: InsertFocusTarget): void {
  if (focusTarget === "block-body" || focusTarget === "footnote-body") {
    return;
  }

  requestAnimationFrame(() => {
    if (focusTarget === "none") {
      return;
    }
    if (focusTarget === "table-cell") {
      focusFirstTableCell(editor, key);
      return;
    }

    const element = editor.getElementByKey(key);
    if (!element) {
      return;
    }

    const selector = FOCUS_SELECTORS[focusTarget];
    if (!selector) {
      return;
    }
    const target = element.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus();
      target.click();
    }
  });
}
