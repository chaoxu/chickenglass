import { $createParagraphNode } from "lexical";

import {
  $createTableCellNode,
  $isTableCellNode,
  type TableCellNode,
} from "./nodes/table-cell-node";
import { $createTableRowNode, $isTableRowNode } from "./nodes/table-row-node";
import type { TableNode } from "./nodes/table-node";

function $getTableRows(table: TableNode) {
  return table.getChildren().filter($isTableRowNode);
}

function $getRowCells(row: ReturnType<typeof $getTableRows>[number]) {
  return row.getChildren().filter($isTableCellNode);
}

function $createEmptyCell(header: boolean): TableCellNode {
  const cell = $createTableCellNode(header);
  cell.append($createParagraphNode());
  return cell;
}

export function $insertRowAfter(table: TableNode, rowIndex: number): void {
  const rows = $getTableRows(table);
  if (rowIndex < 0 || rowIndex >= rows.length) return;

  const columnCount = table.getAlignments().length;
  const newRow = $createTableRowNode();
  for (let i = 0; i < columnCount; i++) {
    newRow.append($createEmptyCell(false));
  }
  rows[rowIndex].insertAfter(newRow);
}

export function $insertRowBefore(table: TableNode, rowIndex: number): void {
  const rows = $getTableRows(table);
  if (rowIndex < 0 || rowIndex >= rows.length) return;

  const columnCount = table.getAlignments().length;
  const newRow = $createTableRowNode();
  // If inserting before the header row, new row is a header row
  const isHeader = rowIndex === 0;
  for (let i = 0; i < columnCount; i++) {
    newRow.append($createEmptyCell(isHeader));
  }
  rows[rowIndex].insertBefore(newRow);

  // If we inserted before the header row, demote the old header row
  if (isHeader) {
    for (const cell of $getRowCells(rows[rowIndex])) {
      cell.setHeader(false);
    }
  }
}

export function $deleteRow(table: TableNode, rowIndex: number): void {
  const rows = $getTableRows(table);
  if (rows.length <= 1) return; // Don't delete last row
  if (rowIndex < 0 || rowIndex >= rows.length) return;

  const wasHeader = rowIndex === 0;
  rows[rowIndex].remove();

  // If we deleted the header row, promote the new first row
  if (wasHeader) {
    const newRows = $getTableRows(table);
    if (newRows.length > 0) {
      for (const cell of $getRowCells(newRows[0])) {
        cell.setHeader(true);
      }
    }
  }
}

function $insertColumn(table: TableNode, columnIndex: number, position: "before" | "after"): void {
  const rows = $getTableRows(table);
  const alignments = table.getAlignments();
  if (columnIndex < 0 || columnIndex >= alignments.length) return;

  const spliceIndex = position === "after" ? columnIndex + 1 : columnIndex;

  for (const row of rows) {
    const cells = $getRowCells(row);
    const isHeader = cells[0]?.isHeader() ?? false;
    const newCell = $createEmptyCell(isHeader);
    if (columnIndex < cells.length) {
      if (position === "after") {
        cells[columnIndex].insertAfter(newCell);
      } else {
        cells[columnIndex].insertBefore(newCell);
      }
    } else {
      row.append(newCell);
    }
  }

  const newAlignments = [...alignments];
  newAlignments.splice(spliceIndex, 0, null);
  table.setAlignments(newAlignments);

  const dividerCells = table.getDividerCells();
  if (dividerCells.length > 0) {
    const newDividerCells = [...dividerCells];
    newDividerCells.splice(spliceIndex, 0, "---");
    table.setDividerCells(newDividerCells);
  }
}

export function $insertColumnAfter(table: TableNode, columnIndex: number): void {
  $insertColumn(table, columnIndex, "after");
}

export function $insertColumnBefore(table: TableNode, columnIndex: number): void {
  $insertColumn(table, columnIndex, "before");
}

export function $deleteColumn(table: TableNode, columnIndex: number): void {
  const alignments = table.getAlignments();
  if (alignments.length <= 1) return; // Don't delete last column
  if (columnIndex < 0 || columnIndex >= alignments.length) return;

  const rows = $getTableRows(table);
  for (const row of rows) {
    const cells = $getRowCells(row);
    if (columnIndex < cells.length) {
      cells[columnIndex].remove();
    }
  }

  const newAlignments = [...alignments];
  newAlignments.splice(columnIndex, 1);
  table.setAlignments(newAlignments);

  const dividerCells = table.getDividerCells();
  if (dividerCells.length > 0) {
    const newDividerCells = [...dividerCells];
    newDividerCells.splice(columnIndex, 1);
    table.setDividerCells(newDividerCells);
  }
}

export function $toggleHeaderRow(table: TableNode): void {
  const rows = $getTableRows(table);
  if (rows.length === 0) return;

  const firstRowCells = $getRowCells(rows[0]);
  const currentlyHeader = firstRowCells.length > 0 && firstRowCells[0].isHeader();

  for (const cell of firstRowCells) {
    cell.setHeader(!currentlyHeader);
  }
}

export function $deleteTable(table: TableNode): void {
  table.remove();
}

/**
 * Given a DOM element inside a table cell, walk up to find
 * the table cell element and determine the row/column indices.
 *
 * coflat's TableNode puts all rows (including header) inside a single
 * `<tbody>`, so we just need the row's position among its siblings.
 */
export function resolveTableCellFromDom(
  target: HTMLElement,
): { cell: HTMLElement; rowIndex: number; columnIndex: number; tableEl: HTMLElement } | null {
  const cell = target.closest<HTMLElement>("th, td");
  if (!cell) return null;

  const row = cell.closest<HTMLElement>("tr");
  if (!row) return null;

  const tableEl = cell.closest<HTMLElement>("table.cf-lexical-table-block");
  if (!tableEl) return null;

  const tbody = tableEl.querySelector<HTMLElement>(":scope > tbody");
  const rowContainer = tbody ?? tableEl;
  const allRows = Array.from(rowContainer.querySelectorAll<HTMLElement>(":scope > tr"));

  const rowIndex = allRows.indexOf(row);
  const columnIndex = Array.from(row.children).indexOf(cell);

  if (rowIndex < 0 || columnIndex < 0) return null;

  return { cell, rowIndex, columnIndex, tableEl };
}
