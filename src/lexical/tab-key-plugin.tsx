import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode, type ListItemNode } from "@lexical/list";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  KEY_TAB_COMMAND,
  type LexicalNode,
} from "lexical";

import { $isTableCellNode, type TableCellNode } from "./nodes/table-cell-node";
import { $isTableNode } from "./nodes/table-node";
import { $isTableRowNode, type TableRowNode } from "./nodes/table-row-node";

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

function $findEnclosingTableCell(node: LexicalNode): TableCellNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isTableCellNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}

function $getRowCells(row: TableRowNode): TableCellNode[] {
  return row.getChildren().filter($isTableCellNode);
}

function $selectTableCell(cell: TableCellNode): void {
  const firstChild = cell.getFirstChild();
  if ($isElementNode(firstChild)) {
    firstChild.selectStart();
    return;
  }
  cell.selectStart();
}

function $moveTableCellSelection(cell: TableCellNode, backwards: boolean): boolean {
  const row = cell.getParent();
  const table = row?.getParent();
  if (!$isTableRowNode(row) || !$isTableNode(table)) {
    return false;
  }

  const rows = table.getChildren().filter($isTableRowNode);
  const rowIndex = rows.indexOf(row);
  const cells = $getRowCells(row);
  const columnIndex = cells.indexOf(cell);
  if (rowIndex < 0 || columnIndex < 0) {
    return false;
  }

  if (!backwards && columnIndex + 1 < cells.length) {
    $selectTableCell(cells[columnIndex + 1]);
    return true;
  }

  if (backwards && columnIndex > 0) {
    $selectTableCell(cells[columnIndex - 1]);
    return true;
  }

  const nextRow = rows[rowIndex + (backwards ? -1 : 1)];
  if (!nextRow) {
    return true;
  }

  const nextCells = $getRowCells(nextRow);
  const targetCell = backwards ? nextCells[nextCells.length - 1] : nextCells[0];
  if (!targetCell) {
    return true;
  }

  $selectTableCell(targetCell);
  return true;
}

/**
 * Handles a `KEY_TAB_COMMAND` dispatch. Always prevents the default
 * browser behavior so Tab cannot move focus out of the contenteditable.
 * Inside a list item, Tab/Shift+Tab adjusts indentation. Inside a table,
 * Tab/Shift+Tab moves between cells so dense table entry stays keyboardable.
 * Elsewhere Tab is a no-op.
 */
export function $handleTabKeyCommand(event: KeyboardEvent): boolean {
  event.preventDefault();

  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return true;
  }

  const tableCell = $findEnclosingTableCell(selection.anchor.getNode());
  if (tableCell) {
    return $moveTableCellSelection(tableCell, event.shiftKey);
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
