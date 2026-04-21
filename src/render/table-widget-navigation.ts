import type { ParsedTable } from "./table-utils";

export type TableCellSection = "header" | "body";
export type TableBoundaryHandoffDirection = "before" | "after";

export interface TableCellAddress {
  readonly section: TableCellSection;
  readonly row: number;
  readonly col: number;
}

export interface TableNavigationModel {
  readonly columnCount: number;
  readonly bodyRowCount: number;
  readonly totalRows: number;
}

export type TableCellNavigationIntent =
  | { readonly kind: "cell"; readonly address: TableCellAddress; readonly placeAtEnd?: boolean }
  | { readonly kind: "handoff"; readonly direction: TableBoundaryHandoffDirection };

export function createTableNavigationModel(table: ParsedTable): TableNavigationModel {
  const columnCount = table.header.cells.length;
  const bodyRowCount = table.rows.length;
  return {
    columnCount,
    bodyRowCount,
    totalRows: 1 + bodyRowCount,
  };
}

export function readTableCellAddress(cell: HTMLElement): TableCellAddress {
  const rawRow = Number.parseInt(cell.dataset.row ?? "0", 10);
  const rawCol = Number.parseInt(cell.dataset.col ?? "0", 10);
  return {
    section: cell.dataset.section === "header" ? "header" : "body",
    row: Number.isFinite(rawRow) ? rawRow : 0,
    col: Number.isFinite(rawCol) ? rawCol : 0,
  };
}

export function linearRowForAddress(address: TableCellAddress): number {
  return address.section === "header" ? 0 : address.row + 1;
}

export function addressForLinearRow(linearRow: number, col: number): TableCellAddress {
  return linearRow === 0
    ? { section: "header", row: 0, col }
    : { section: "body", row: linearRow - 1, col };
}

export function moveTableCellHorizontally(
  model: TableNavigationModel,
  address: TableCellAddress,
  direction: "left" | "right",
): TableCellNavigationIntent {
  const currentLinear = linearRowForAddress(address);
  const delta = direction === "left" ? -1 : 1;
  let targetCol = address.col + delta;
  let targetLinear = currentLinear;

  if (targetCol < 0) {
    targetCol = model.columnCount - 1;
    targetLinear -= 1;
  } else if (targetCol >= model.columnCount) {
    targetCol = 0;
    targetLinear += 1;
  }

  if (targetLinear < 0) {
    return { kind: "handoff", direction: "before" };
  }
  if (targetLinear >= model.totalRows) {
    return { kind: "handoff", direction: "after" };
  }

  return {
    kind: "cell",
    address: addressForLinearRow(targetLinear, targetCol),
    placeAtEnd: direction === "left",
  };
}

export function moveTableCellVertically(
  model: TableNavigationModel,
  address: TableCellAddress,
  direction: "up" | "down",
): TableCellNavigationIntent {
  const currentLinear = linearRowForAddress(address);
  const targetLinear = currentLinear + (direction === "up" ? -1 : 1);

  if (targetLinear < 0) {
    return { kind: "handoff", direction: "before" };
  }
  if (targetLinear >= model.totalRows) {
    return { kind: "handoff", direction: "after" };
  }

  return {
    kind: "cell",
    address: addressForLinearRow(targetLinear, address.col),
  };
}

export function moveTableCellByTab(
  model: TableNavigationModel,
  address: TableCellAddress,
  shiftKey: boolean,
): TableCellNavigationIntent | { readonly kind: "append-row"; readonly col: number } {
  if (shiftKey) {
    return moveTableCellHorizontally(model, address, "left");
  }

  const intent = moveTableCellHorizontally(model, address, "right");
  return intent.kind === "handoff"
    ? { kind: "append-row", col: 0 }
    : intent;
}
