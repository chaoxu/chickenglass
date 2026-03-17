/**
 * CM6 ViewPlugin for interactive table rendering.
 *
 * Behavior:
 * - Cursor INSIDE table: show styled grid with floating toolbar
 *   (add/delete row/col), enable Tab/Enter navigation.
 * - Cursor OUTSIDE table: hide separator row, apply cg-table styling.
 * - Auto-format after cell edits via transactions.
 *
 * Inline markdown (math, bold, etc.) works inside table cells because
 * we use Decoration.mark (not replace) for styling and only hide the
 * separator row via Decoration.replace when cursor is outside.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type Extension,
  type Range,
  Prec,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { buildDecorations } from "./render-utils";
import { parseTable, formatTable, addRow, addColumn, deleteRow, deleteColumn } from "./table-utils";
import type { ParsedTable } from "./table-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A table found in the document with its source range. */
interface TableRange {
  /** Start of the Table node in the document. */
  readonly from: number;
  /** End of the Table node in the document. */
  readonly to: number;
  /** Start of the separator row line. */
  readonly separatorFrom: number;
  /** End of the separator row line (including newline). */
  readonly separatorTo: number;
  /** Parsed table data. */
  readonly parsed: ParsedTable;
  /** The lines of the table as they appear in the document. */
  readonly lines: readonly string[];
  /** Document line number of the first table line (1-based). */
  readonly startLineNumber: number;
}

// ---------------------------------------------------------------------------
// Shared pipe-scanning helper
// ---------------------------------------------------------------------------

/** Find the positions of all unescaped pipe characters in a string. */
function findPipePositions(text: string): number[] {
  const pipes: number[] = [];
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    if (escaped) {
      escaped = false;
    } else if (text[i] === "\\") {
      escaped = true;
    } else if (text[i] === "|") {
      pipes.push(i);
    }
  }
  return pipes;
}

// ---------------------------------------------------------------------------
// Shared decoration constants (avoid allocating per-pipe/per-table)
// ---------------------------------------------------------------------------

const tableMarkDecoration = Decoration.mark({ class: "cg-table" });
const headerMarkDecoration = Decoration.mark({ class: "cg-table-header" });
const separatorMarkDecoration = Decoration.mark({ class: "cg-table-separator" });
const pipeMarkDecoration = Decoration.mark({ class: "cg-table-pipe" });

// ---------------------------------------------------------------------------
// Table detection from syntax tree
// ---------------------------------------------------------------------------

/** Find all Table nodes in the visible ranges and parse them. */
function findTables(view: EditorView): TableRange[] {
  const tables: TableRange[] = [];
  const doc = view.state.doc;

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        if (node.name !== "Table") return;

        const tableFrom = node.from;
        const tableTo = node.to;

        // Extract lines from the document
        const startLine = doc.lineAt(tableFrom);
        const endLine = doc.lineAt(tableTo);
        const lines: string[] = [];
        for (let ln = startLine.number; ln <= endLine.number; ln++) {
          lines.push(doc.line(ln).text);
        }

        const parsed = parseTable(lines);
        if (!parsed) return;

        // Find separator row (line index 1 in the table)
        const sepLine = doc.line(startLine.number + 1);
        const separatorFrom = sepLine.from;
        // Include trailing newline if present
        const separatorTo =
          sepLine.to < doc.length ? sepLine.to + 1 : sepLine.to;

        tables.push({
          from: tableFrom,
          to: tableTo,
          separatorFrom,
          separatorTo,
          parsed,
          lines,
          startLineNumber: startLine.number,
        });
      },
    });
  }
  return tables;
}

/** Find the table containing the given cursor position, or null. */
function findTableAtCursor(
  tables: readonly TableRange[],
  cursorPos: number,
): TableRange | null {
  for (const table of tables) {
    if (cursorPos >= table.from && cursorPos <= table.to) return table;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Toolbar widget
// ---------------------------------------------------------------------------

/** Floating toolbar widget shown above an active table. */
class TableToolbarWidget extends WidgetType {
  constructor(
    private readonly tableRange: TableRange,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "cg-table-toolbar";

    const makeBtn = (label: string, title: string, handler: () => void): void => {
      const btn = document.createElement("button");
      btn.className = "cg-table-toolbar-btn";
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        handler();
      });
      toolbar.appendChild(btn);
    };

    makeBtn("+Row", "Add row below", () => {
      applyTableMutation(view, this.tableRange, (table) => {
        const cursorRow = getCursorRowIndex(view, this.tableRange);
        return addRow(table, cursorRow !== null ? cursorRow + 1 : undefined);
      });
    });

    makeBtn("+Col", "Add column to the right", () => {
      applyTableMutation(view, this.tableRange, (table) => {
        const cursorCol = getCursorColIndex(view, this.tableRange);
        return addColumn(table, cursorCol !== null ? cursorCol + 1 : undefined);
      });
    });

    makeBtn("-Row", "Delete current row", () => {
      applyTableMutation(view, this.tableRange, (table) => {
        const cursorRow = getCursorRowIndex(view, this.tableRange);
        if (cursorRow === null || table.rows.length === 0) return table;
        return deleteRow(table, cursorRow);
      });
    });

    makeBtn("-Col", "Delete current column", () => {
      applyTableMutation(view, this.tableRange, (table) => {
        const cursorCol = getCursorColIndex(view, this.tableRange);
        if (cursorCol === null) return table;
        return deleteColumn(table, cursorCol);
      });
    });

    return toolbar;
  }

  eq(other: TableToolbarWidget): boolean {
    return (
      this.tableRange.from === other.tableRange.from &&
      this.tableRange.to === other.tableRange.to
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Cursor position helpers
// ---------------------------------------------------------------------------

/** Get the 0-based data row index the cursor is on, or null. */
function getCursorRowIndex(
  view: EditorView,
  table: TableRange,
): number | null {
  const cursorPos = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursorPos).number;
  // Header is line 0, separator is line 1, data rows start at line 2
  const rowIndex = cursorLine - table.startLineNumber - 2;
  if (rowIndex < 0 || rowIndex >= table.parsed.rows.length) return null;
  return rowIndex;
}

/** Get the 0-based column index the cursor is in, or null. */
function getCursorColIndex(
  view: EditorView,
  table: TableRange,
): number | null {
  const cursorPos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursorPos);
  const cursorCol = cursorPos - line.from;

  // Count unescaped pipes before cursor position to determine column
  const pipes = findPipePositions(line.text.slice(0, cursorCol));
  let col = pipes.length - 1;
  if (col < 0) col = 0;
  if (col >= table.parsed.header.cells.length) {
    col = table.parsed.header.cells.length - 1;
  }
  return col;
}

// ---------------------------------------------------------------------------
// Table mutation
// ---------------------------------------------------------------------------

/** Apply a mutation to a table and replace its text in the document. */
function applyTableMutation(
  view: EditorView,
  table: TableRange,
  mutate: (parsed: ParsedTable) => ParsedTable,
): void {
  const newTable = mutate(table.parsed);
  const newLines = formatTable(newTable);
  const newText = newLines.join("\n");

  view.dispatch({
    changes: { from: table.from, to: table.to, insert: newText },
  });
}

// ---------------------------------------------------------------------------
// Auto-format
// ---------------------------------------------------------------------------

/** Format the table containing the cursor. Uses the already-found table range. */
function autoFormatTableRange(view: EditorView, table: TableRange): void {
  const formatted = formatTable(table.parsed);
  const newText = formatted.join("\n");
  const currentText = view.state.doc.sliceString(table.from, table.to);
  if (newText !== currentText) {
    const cursorPos = view.state.selection.main.head;
    const relPos = cursorPos - table.from;
    const newCursorPos = Math.min(table.from + relPos, table.from + newText.length);
    view.dispatch({
      changes: { from: table.from, to: table.to, insert: newText },
      selection: { anchor: newCursorPos },
    });
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Find the cell boundaries for a given position in a table line. */
function findCellBounds(
  lineText: string,
  lineFrom: number,
  colIndex: number,
): { from: number; to: number } | null {
  const pipes = findPipePositions(lineText);

  if (pipes.length < 2) return null;

  // Cell N is between pipe[N] and pipe[N+1]
  if (colIndex >= pipes.length - 1) return null;

  const cellStart = pipes[colIndex] + 1;
  const cellEnd = pipes[colIndex + 1];

  // Find the trimmed content bounds within the cell
  let contentStart = cellStart;
  while (contentStart < cellEnd && lineText[contentStart] === " ") contentStart++;
  let contentEnd = cellEnd;
  while (contentEnd > contentStart && lineText[contentEnd - 1] === " ") contentEnd--;

  return { from: lineFrom + contentStart, to: lineFrom + contentEnd };
}

/** Skip the separator row index (line index 1 in the table). */
function skipSeparator(lineIdx: number, direction: 1 | -1): number {
  return lineIdx === 1 ? lineIdx + direction : lineIdx;
}

/** Move cursor to the next cell (Tab). Returns true if handled. */
function nextCell(view: EditorView): boolean {
  const tables = findTables(view);
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

  // Past the last row: add a new row
  const totalLines = table.lines.length;
  if (nextLineIdx >= totalLines) {
    applyTableMutation(view, table, (t) => addRow(t));
    // After mutation, move to first cell of new last row
    const newTables = findTables(view);
    const nt = findTableAtCursor(newTables, table.from);
    if (nt) {
      const targetLineNum = nt.startLineNumber + nt.lines.length - 1;
      const lastLine = view.state.doc.line(targetLineNum);
      const bounds = findCellBounds(lastLine.text, lastLine.from, 0);
      if (bounds) {
        view.dispatch({ selection: { anchor: bounds.from } });
      }
    }
    return true;
  }

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const bounds = findCellBounds(targetLine.text, targetLine.from, nextColIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from } });
  }
  return true;
}

/** Move cursor to the previous cell (Shift+Tab). Returns true if handled. */
function previousCell(view: EditorView): boolean {
  const tables = findTables(view);
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

  if (prevLineIdx < 0) return true; // Already at the start

  const targetLineNum = table.startLineNumber + prevLineIdx;
  const targetLine = doc.line(targetLineNum);
  const bounds = findCellBounds(targetLine.text, targetLine.from, prevColIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from } });
  }
  return true;
}

/** Move cursor to the next row (Enter). Returns true if handled. */
function nextRow(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const cursorLine = doc.lineAt(cursorPos);
  const lineIdx = cursorLine.number - table.startLineNumber;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const nextLineIdx = skipSeparator(lineIdx + 1, 1);

  const totalLines = table.lines.length;
  if (nextLineIdx >= totalLines) {
    // Add new row at the end
    applyTableMutation(view, table, (t) => addRow(t));
    // Move to the same column in the new last row
    const targetLineNum = table.startLineNumber + totalLines;
    if (targetLineNum <= view.state.doc.lines) {
      const targetLine = view.state.doc.line(targetLineNum);
      const bounds = findCellBounds(targetLine.text, targetLine.from, colIdx);
      if (bounds) {
        view.dispatch({ selection: { anchor: bounds.from } });
      }
    }
    return true;
  }

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const bounds = findCellBounds(targetLine.text, targetLine.from, colIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from } });
  }
  return true;
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

class TableRenderPluginValue implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const tables = findTables(view);
    const cursor = view.state.selection.main;
    const hasFocus = view.hasFocus;
    const doc = view.state.doc;

    const items: Range<Decoration>[] = [];

    for (const table of tables) {
      const cursorInTable =
        hasFocus && cursor.from >= table.from && cursor.to <= table.to;

      // Always apply table wrapper styling
      items.push(tableMarkDecoration.range(table.from, table.to));

      if (cursorInTable) {
        // Cursor is inside: show toolbar widget above the table
        items.push(
          Decoration.widget({
            widget: new TableToolbarWidget(table),
            side: -1,
          }).range(table.from),
        );

        // Style the separator row distinctly when editing
        items.push(
          separatorMarkDecoration.range(
            table.separatorFrom,
            // Don't include trailing newline in mark
            Math.min(table.separatorTo, doc.lineAt(table.separatorFrom).to),
          ),
        );
      } else {
        // Cursor outside: hide the separator row
        const sepLine = doc.lineAt(table.separatorFrom);
        items.push(
          Decoration.replace({}).range(
            sepLine.from,
            Math.min(sepLine.to + 1, doc.length),
          ),
        );
      }

      // Style header row
      const headerLine = doc.line(table.startLineNumber);
      items.push(
        headerMarkDecoration.range(headerLine.from, headerLine.to),
      );

      // Style pipe delimiters in all visible rows
      const endLine = doc.lineAt(table.to);
      for (let ln = table.startLineNumber; ln <= endLine.number; ln++) {
        // Skip separator row when cursor is outside (it's hidden)
        if (!cursorInTable && ln === table.startLineNumber + 1) continue;
        const line = doc.line(ln);
        const pipes = findPipePositions(line.text);
        for (const p of pipes) {
          items.push(
            pipeMarkDecoration.range(line.from + p, line.from + p + 1),
          );
        }
      }
    }

    return buildDecorations(items);
  }
}

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

/** Table-specific keybindings. Must be high-precedence to override defaults. */
const tableKeybindings: Extension = Prec.high(
  keymap.of([
    { key: "Tab", run: nextCell },
    { key: "Shift-Tab", run: previousCell },
    { key: "Enter", run: nextRow },
    {
      key: "Mod-Shift-f",
      run(view: EditorView): boolean {
        const tables = findTables(view);
        const cursorPos = view.state.selection.main.head;
        const table = findTableAtCursor(tables, cursorPos);
        if (!table) return false;
        autoFormatTableRange(view, table);
        return true;
      },
    },
  ]),
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** CM6 extension for interactive table editing. */
export const tableRenderPlugin: Extension = [
  ViewPlugin.fromClass(TableRenderPluginValue, {
    decorations: (v) => v.decorations,
  }),
  tableKeybindings,
];
