import { Prec, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import {
  findCellBounds,
  findTableAtCursor,
  findTablesInState,
  getCursorColIndex,
  skipSeparator,
} from "./table-discovery";
import { appendTableWidgetRowAndFocus } from "./table-widget-mutations";

/** Move cursor to the next cell (Tab). Returns true if handled. */
function nextCell(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const cursorLine = doc.lineAt(cursorPos);
  const lineIdx = cursorLine.number - table.startLineNumber;
  const colCount = table.parsed.header.cells.length;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  let nextLineIdx = skipSeparator(lineIdx, 1);
  let nextColIdx = colIdx + 1;

  if (nextColIdx >= colCount) {
    nextColIdx = 0;
    nextLineIdx = skipSeparator(nextLineIdx + 1, 1);
  }

  const totalLines = table.lines.length;
  if (nextLineIdx >= totalLines) {
    appendTableWidgetRowAndFocus({
      rootView: view,
      tableRange: table,
      tableFrom: table.from,
      bodyRowCount: table.parsed.rows.length,
      targetCol: 0,
    });
    const newTables = findTablesInState(view.state);
    const nextTable = findTableAtCursor(newTables, table.from);
    if (nextTable) {
      const targetLineNum = nextTable.startLineNumber + nextTable.lines.length - 1;
      const lastLine = view.state.doc.line(targetLineNum);
      const bounds = findCellBounds(lastLine.text, lastLine.from, 0);
      if (bounds) {
        view.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: false });
      }
    }
    return true;
  }

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const bounds = findCellBounds(targetLine.text, targetLine.from, nextColIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: false });
  }
  return true;
}

/** Move cursor to the previous cell (Shift+Tab). Returns true if handled. */
function previousCell(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const cursorLine = doc.lineAt(cursorPos);
  const lineIdx = cursorLine.number - table.startLineNumber;
  const colCount = table.parsed.header.cells.length;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  let prevLineIdx = lineIdx;
  let prevColIdx = colIdx - 1;

  if (prevColIdx < 0) {
    prevColIdx = colCount - 1;
    prevLineIdx = skipSeparator(prevLineIdx - 1, -1);
  }

  if (prevLineIdx < 0) return true;

  const targetLineNum = table.startLineNumber + prevLineIdx;
  const targetLine = doc.line(targetLineNum);
  const bounds = findCellBounds(targetLine.text, targetLine.from, prevColIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: false });
  }
  return true;
}

/** Move cursor to the next row (Enter). Returns true if handled. */
function nextRow(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const cursorLine = doc.lineAt(cursorPos);
  const lineIdx = cursorLine.number - table.startLineNumber;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;
  const targetColIdx = lineIdx === 1 ? 0 : colIdx;

  const nextLineIdx = skipSeparator(lineIdx + 1, 1);

  const totalLines = table.lines.length;
  if (nextLineIdx >= totalLines) {
    appendTableWidgetRowAndFocus({
      rootView: view,
      tableRange: table,
      tableFrom: table.from,
      bodyRowCount: table.parsed.rows.length,
      targetCol: targetColIdx,
    });
    const targetLineNum = table.startLineNumber + totalLines;
    if (targetLineNum <= view.state.doc.lines) {
      const targetLine = view.state.doc.line(targetLineNum);
      const bounds = findCellBounds(targetLine.text, targetLine.from, targetColIdx);
      if (bounds) {
        view.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: false });
      }
    }
    return true;
  }

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const bounds = findCellBounds(targetLine.text, targetLine.from, targetColIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: false });
  }
  return true;
}

/** ArrowLeft: at cell start, jump to end of previous cell. */
function arrowLeft(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds || cursorPos !== bounds.from) return false;

  const lineIdx = line.number - table.startLineNumber;
  let prevLineIdx = lineIdx;
  let prevColIdx = colIdx - 1;

  if (prevColIdx < 0) {
    prevColIdx = table.parsed.header.cells.length - 1;
    prevLineIdx = skipSeparator(prevLineIdx - 1, -1);
  }

  if (prevLineIdx < 0) return false;

  const targetLineNum = table.startLineNumber + prevLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, prevColIdx);
  if (targetBounds) {
    view.dispatch({ selection: { anchor: targetBounds.to }, scrollIntoView: false });
  }
  return true;
}

/** ArrowRight: at cell end, jump to start of next cell. */
function arrowRight(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds || cursorPos !== bounds.to) return false;

  const lineIdx = line.number - table.startLineNumber;
  const colCount = table.parsed.header.cells.length;
  let nextLineIdx = lineIdx;
  let nextColIdx = colIdx + 1;

  if (nextColIdx >= colCount) {
    nextColIdx = 0;
    nextLineIdx = skipSeparator(nextLineIdx + 1, 1);
  }

  if (nextLineIdx >= table.lines.length) return false;

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, nextColIdx);
  if (targetBounds) {
    view.dispatch({ selection: { anchor: targetBounds.from }, scrollIntoView: false });
  }
  return true;
}

/** ArrowUp: move to same column in previous row. */
function arrowUp(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const lineIdx = line.number - table.startLineNumber;

  const prevLineIdx = skipSeparator(lineIdx - 1, -1);
  if (prevLineIdx < 0) return false;

  const targetLineNum = table.startLineNumber + prevLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, colIdx);
  if (targetBounds) {
    const offset = cursorPos - (findCellBounds(line.text, line.from, colIdx)?.from ?? cursorPos);
    const clamped = Math.min(targetBounds.from + offset, targetBounds.to);
    view.dispatch({ selection: { anchor: clamped }, scrollIntoView: false });
  }
  return true;
}

/** ArrowDown: move to same column in next row. */
function arrowDown(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const lineIdx = line.number - table.startLineNumber;

  const nextLineIdx = skipSeparator(lineIdx + 1, 1);
  if (nextLineIdx >= table.lines.length) return false;

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, colIdx);
  if (targetBounds) {
    const offset = cursorPos - (findCellBounds(line.text, line.from, colIdx)?.from ?? cursorPos);
    const clamped = Math.min(targetBounds.from + offset, targetBounds.to);
    view.dispatch({ selection: { anchor: clamped }, scrollIntoView: false });
  }
  return true;
}

/** Backspace: prevent deleting at cell start (would destroy pipe). */
function backspaceStop(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;

  if (!view.state.selection.main.empty) return false;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = view.state.doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds) return false;

  return cursorPos === bounds.from;
}

/** Delete: prevent deleting at cell end (would destroy pipe). */
function deleteStop(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const cursorPos = view.state.selection.main.head;

  if (!view.state.selection.main.empty) return false;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = view.state.doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds) return false;

  return cursorPos === bounds.to;
}

/** Table-specific keybindings. Must be high-precedence to override defaults. */
export const tableKeybindings: Extension = Prec.high(
  keymap.of([
    { key: "Tab", run: nextCell },
    { key: "Shift-Tab", run: previousCell },
    { key: "Enter", run: nextRow },
    { key: "ArrowLeft", run: arrowLeft },
    { key: "ArrowRight", run: arrowRight },
    { key: "ArrowUp", run: arrowUp },
    { key: "ArrowDown", run: arrowDown },
    { key: "Backspace", run: backspaceStop },
    { key: "Delete", run: deleteStop },
  ]),
);
