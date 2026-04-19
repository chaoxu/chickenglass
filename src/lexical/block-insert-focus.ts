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
import {
  getInsertFocusBehavior,
  type InsertFocusTarget,
} from "./block-insert-focus-targets";
import { ACTIVATE_STRUCTURE_EDIT_COMMAND } from "./structure-edit-plugin";
import { queueEmbeddedSurfaceFocus } from "./pending-surface-focus";
import { COFLAT_NESTED_EDIT_TAG } from "./update-tags";
import { activateDomSurface } from "./surface-activation";

export type { InsertFocusTarget };

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
  const behavior = getInsertFocusBehavior(focusTarget);
  const pendingFocus = behavior.pendingFocus;
  if (pendingFocus) {
    queueEmbeddedSurfaceFocus(
      editor.getKey(),
      key,
      pendingFocus.target,
      pendingFocus.request,
    );
  }

  if (behavior.activation.kind === "none") {
    return;
  }

  if (behavior.activation.kind === "structure-edit") {
    editor.dispatchCommand(ACTIVATE_STRUCTURE_EDIT_COMMAND, {
      blockKey: key,
      surface: behavior.activation.surface,
      variant: behavior.activation.variant,
    });
    return;
  }

  requestAnimationFrame(() => {
    if (behavior.activation.kind === "table-cell") {
      focusFirstTableCell(editor, key);
      return;
    }

    const element = editor.getElementByKey(key);
    if (!element) {
      return;
    }

    if (behavior.activation.kind !== "dom-selector") {
      return;
    }
    const target = element.querySelector<HTMLElement>(behavior.activation.selector);
    if (target) {
      activateDomSurface(target);
    }
  });
}
