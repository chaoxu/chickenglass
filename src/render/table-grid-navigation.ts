import {
  type EditorView,
  type KeyBinding,
} from "@codemirror/view";

import {
  adjacentTableLine,
  findCellAtPos,
  getCellBounds,
} from "./table-cell-geometry";
import {
  findPipePositions,
  findTableAtCursor,
  findTablesInState,
} from "./table-discovery";

export function moveTableGridCursorVertical(
  view: EditorView,
  direction: 1 | -1,
): boolean {
  const pos = view.state.selection.main.head;
  const tables = findTablesInState(view.state);
  if (!findTableAtCursor(tables, pos)) return false;

  const line = view.state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  const result = findCellAtPos(pos, line, pipes);
  if (!result) return false;

  const offsetInCell = Math.max(0, pos - result.cell.from);
  const targetLine = adjacentTableLine(view.state.doc, line.number, direction);
  if (!targetLine || !findTableAtCursor(tables, targetLine.from)) return false;

  const targetPipes = findPipePositions(targetLine.text);
  const targetCells = getCellBounds(targetLine, targetPipes);
  const targetCell = targetCells.find((cell) => cell.col === result.cell.col);
  if (!targetCell) return false;

  const offset = Math.min(offsetInCell, targetCell.to - targetCell.from);
  view.dispatch({ selection: { anchor: targetCell.from + offset } });
  return true;
}

export function findNextTableGridCell(view: EditorView, forward: boolean): number | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  const result = findCellAtPos(pos, line, pipes);
  if (!result) return null;

  const dir = forward ? 1 : -1;
  const adjacent = result.cells.find((cell) => cell.col === result.cell.col + dir);
  if (adjacent) return adjacent.from;

  const targetLine = adjacentTableLine(view.state.doc, line.number, dir as 1 | -1);
  if (targetLine) {
    const targetPipes = findPipePositions(targetLine.text);
    const targetCells = getCellBounds(targetLine, targetPipes);
    if (targetCells.length > 0) {
      return forward ? targetCells[0].from : targetCells[targetCells.length - 1].from;
    }
  }
  return null;
}

export function cursorInTableGrid(view: EditorView): boolean {
  return findTableAtCursor(findTablesInState(view.state), view.state.selection.main.head) !== null;
}

export function createTableGridKeyBindings(
  deleteSelectedTableSelection: (view: EditorView) => boolean,
): KeyBinding[] {
  return [
    { key: "Enter", run: cursorInTableGrid },
    {
      key: "Tab",
      run(view) {
        if (!cursorInTableGrid(view)) return false;
        const next = findNextTableGridCell(view, true);
        if (next !== null) {
          view.dispatch({ selection: { anchor: next } });
          return true;
        }
        return false;
      },
    },
    {
      key: "Shift-Tab",
      run(view) {
        if (!cursorInTableGrid(view)) return false;
        const prev = findNextTableGridCell(view, false);
        if (prev !== null) {
          view.dispatch({ selection: { anchor: prev } });
          return true;
        }
        return false;
      },
    },
    { key: "ArrowUp", run: (view) => moveTableGridCursorVertical(view, -1) },
    { key: "ArrowDown", run: (view) => moveTableGridCursorVertical(view, 1) },
    { key: "Backspace", run: deleteSelectedTableSelection },
    { key: "Delete", run: deleteSelectedTableSelection },
  ];
}
