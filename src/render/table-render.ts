/**
 * CM6 StateField for interactive table rendering.
 *
 * Behavior:
 * - Cursor OUTSIDE table: render as HTML <table> via Decoration.replace
 *   with TableWidget (inline math, bold, italic rendered in cells).
 * - Cursor INSIDE table: show raw markdown source for editing,
 *   with floating toolbar (add/delete row/col) and Tab/Enter navigation.
 * - Clicking a rendered table places the cursor inside, revealing source.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import {
  Annotation,
  type EditorState,
  type Extension,
  type Range,
  Prec,
  StateField,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  buildDecorations,
  editorFocusField,
  focusTracker,
} from "./render-utils";
import { renderInlineMarkdown } from "./inline-render";
import { mathMacrosField } from "./math-macros";
import {
  parseTable,
  formatTable,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  setAlignment,
  moveRow,
  moveColumn,
} from "./table-utils";
import type { ParsedTable } from "./table-utils";
import { ContextMenu } from "../app/context-menu";
import type { ContextMenuItem } from "../app/context-menu";
import { createInlineEditor } from "../editor/inline-editor";

// ---------------------------------------------------------------------------
// Cell-edit annotation — marks dispatches that originate from inline editor
// cell syncing so the StateField can map positions instead of rebuilding.
// ---------------------------------------------------------------------------

/**
 * Annotation attached to transactions dispatched by cell-edit sync.
 * When `true`, the StateField maps existing decorations through the
 * change instead of fully rebuilding — preventing the widget from
 * being destroyed mid-edit.
 */
const cellEditAnnotation = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// Active inline editor tracking — only one cell editor at a time
// ---------------------------------------------------------------------------

/** Module-level reference to the currently active inline cell editor. */
let activeInlineEditor: {
  view: EditorView;
  cell: HTMLElement;
  tableWidget: TableWidget;
} | null = null;

/**
 * Destroy the currently active inline editor (if any) and return
 * the final document text from that editor.
 */
function destroyActiveInlineEditor(): string {
  if (!activeInlineEditor) return "";
  const { view: inlineView, cell } = activeInlineEditor;
  const text = inlineView.state.doc.toString();
  inlineView.destroy();
  cell.classList.remove("cg-table-cell-editing");
  cell.innerHTML = "";
  activeInlineEditor = null;
  return text;
}

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
// Table detection from syntax tree
// ---------------------------------------------------------------------------

/** Find all Table nodes in the visible ranges and parse them. */
function findTables(view: EditorView): TableRange[] {
  const tables: TableRange[] = [];
  const seen = new Set<number>();
  const doc = view.state.doc;

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        if (node.name !== "Table") return;
        // Deduplicate: a Table node can span multiple visible ranges
        // when inline Decoration.replace (e.g. math widgets) creates gaps
        if (seen.has(node.from)) return;
        seen.add(node.from);

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
// Toolbar builder helper (used inside TableWidget.toDOM)
// ---------------------------------------------------------------------------

/**
 * Build toolbar DOM with all table-editing buttons.
 * The toolbar gets the currently active cell from `getActiveCell`.
 */
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
// Context menu
// ---------------------------------------------------------------------------

/** Show a context menu for a table at the given screen coordinates. */
function showTableContextMenu(
  view: EditorView,
  table: TableRange,
  x: number,
  y: number,
): void {
  const cursorRow = getCursorRowIndex(view, table);
  const cursorCol = getCursorColIndex(view, table);

  const items: ContextMenuItem[] = [
    {
      label: "Insert Row Above",
      disabled: cursorRow === null,
      action: () => {
        applyTableMutation(view, table, (t) =>
          addRow(t, cursorRow ?? 0),
        );
      },
    },
    {
      label: "Insert Row Below",
      action: () => {
        applyTableMutation(view, table, (t) =>
          addRow(t, cursorRow !== null ? cursorRow + 1 : undefined),
        );
      },
    },
    {
      label: "Insert Column Left",
      action: () => {
        applyTableMutation(view, table, (t) =>
          addColumn(t, cursorCol ?? 0),
        );
      },
    },
    {
      label: "Insert Column Right",
      action: () => {
        applyTableMutation(view, table, (t) =>
          addColumn(t, cursorCol !== null ? cursorCol + 1 : undefined),
        );
      },
    },
    { label: "-" },
    {
      label: "Delete Row",
      disabled: cursorRow === null || table.parsed.rows.length === 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (t) => deleteRow(t, cursorRow));
      },
    },
    {
      label: "Delete Column",
      disabled: cursorCol === null || table.parsed.header.cells.length <= 1,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (t) => deleteColumn(t, cursorCol));
      },
    },
    { label: "-" },
    {
      label: "Align Left",
      disabled: cursorCol === null,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (t) => setAlignment(t, cursorCol, "left"));
      },
    },
    {
      label: "Align Center",
      disabled: cursorCol === null,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (t) => setAlignment(t, cursorCol, "center"));
      },
    },
    {
      label: "Align Right",
      disabled: cursorCol === null,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (t) => setAlignment(t, cursorCol, "right"));
      },
    },
    { label: "-" },
    {
      label: "Move Row Up",
      disabled: cursorRow === null || cursorRow <= 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (t) => moveRow(t, cursorRow, cursorRow - 1));
      },
    },
    {
      label: "Move Row Down",
      disabled: cursorRow === null || cursorRow >= table.parsed.rows.length - 1,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (t) => moveRow(t, cursorRow, cursorRow + 1));
      },
    },
    {
      label: "Move Column Left",
      disabled: cursorCol === null || cursorCol <= 0,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (t) => moveColumn(t, cursorCol, cursorCol - 1));
      },
    },
    {
      label: "Move Column Right",
      disabled: cursorCol === null || cursorCol >= table.parsed.header.cells.length - 1,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (t) => moveColumn(t, cursorCol, cursorCol + 1));
      },
    },
  ];

  new ContextMenu(items, x, y);
}

/**
 * Show a context menu for a widget table cell using explicit coordinates.
 *
 * Unlike showTableContextMenu which reads row/col from the editor cursor,
 * this variant takes explicit section/row/col from the widget's data
 * attributes — needed because the widget has ignoreEvent() returning true,
 * so the CM6 cursor may not be positioned inside the table.
 */
function showWidgetContextMenu(
  view: EditorView,
  table: TableRange,
  section: string,
  row: number,
  col: number,
  x: number,
  y: number,
): void {
  // For the context menu, cursorRow is the 0-based body row index (null for header)
  const cursorRow = section === "header" ? null : row;
  const cursorCol = col;

  const items: ContextMenuItem[] = [
    {
      label: "Insert Row Above",
      disabled: cursorRow === null,
      action: () => {
        applyTableMutation(view, table, (t) =>
          addRow(t, cursorRow ?? 0),
        );
      },
    },
    {
      label: "Insert Row Below",
      action: () => {
        applyTableMutation(view, table, (t) =>
          addRow(t, cursorRow !== null ? cursorRow + 1 : undefined),
        );
      },
    },
    {
      label: "Insert Column Left",
      action: () => {
        applyTableMutation(view, table, (t) =>
          addColumn(t, cursorCol),
        );
      },
    },
    {
      label: "Insert Column Right",
      action: () => {
        applyTableMutation(view, table, (t) =>
          addColumn(t, cursorCol + 1),
        );
      },
    },
    { label: "-" },
    {
      label: "Delete Row",
      disabled: cursorRow === null || table.parsed.rows.length === 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (t) => deleteRow(t, cursorRow));
      },
    },
    {
      label: "Delete Column",
      disabled: table.parsed.header.cells.length <= 1,
      action: () => {
        applyTableMutation(view, table, (t) => deleteColumn(t, cursorCol));
      },
    },
    { label: "-" },
    {
      label: "Align Left",
      action: () => {
        applyTableMutation(view, table, (t) => setAlignment(t, cursorCol, "left"));
      },
    },
    {
      label: "Align Center",
      action: () => {
        applyTableMutation(view, table, (t) => setAlignment(t, cursorCol, "center"));
      },
    },
    {
      label: "Align Right",
      action: () => {
        applyTableMutation(view, table, (t) => setAlignment(t, cursorCol, "right"));
      },
    },
    { label: "-" },
    {
      label: "Move Row Up",
      disabled: cursorRow === null || cursorRow <= 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (t) => moveRow(t, cursorRow, cursorRow - 1));
      },
    },
    {
      label: "Move Row Down",
      disabled: cursorRow === null || cursorRow >= table.parsed.rows.length - 1,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (t) => moveRow(t, cursorRow, cursorRow + 1));
      },
    },
    {
      label: "Move Column Left",
      disabled: cursorCol <= 0,
      action: () => {
        applyTableMutation(view, table, (t) => moveColumn(t, cursorCol, cursorCol - 1));
      },
    },
    {
      label: "Move Column Right",
      disabled: cursorCol >= table.parsed.header.cells.length - 1,
      action: () => {
        applyTableMutation(view, table, (t) => moveColumn(t, cursorCol, cursorCol + 1));
      },
    },
  ];

  new ContextMenu(items, x, y);
}

// ---------------------------------------------------------------------------
// Insert Table
// ---------------------------------------------------------------------------

/**
 * Insert a blank table at the cursor position.
 *
 * @param view - The editor view.
 * @param rows - Number of data rows (default 3).
 * @param cols - Number of columns (default 3).
 */
export function insertTable(
  view: EditorView,
  rows = 3,
  cols = 3,
): void {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  // Insert on a new line if cursor is not at the start of an empty line
  const prefix = line.text.trim() === "" && from === line.from ? "" : "\n";

  const header = "| " + Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(" | ") + " |";
  const separator = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const emptyRow = "| " + Array.from({ length: cols }, () => "   ").join(" | ") + " |";
  const dataRows = Array.from({ length: rows }, () => emptyRow).join("\n");

  const tableText = `${prefix}${header}\n${separator}\n${dataRows}\n`;

  view.dispatch({
    changes: { from, to, insert: tableText },
    // Place cursor in the first data cell
    selection: { anchor: from + prefix.length + header.length + 1 + separator.length + 1 + 2 },
  });
  view.focus();
}

// ---------------------------------------------------------------------------
// StateField — Decoration.replace with TableWidget
// ---------------------------------------------------------------------------

/**
 * Find all tables using the syntax tree from EditorState.
 * Unlike the view-based findTables(), this does not filter by visible ranges
 * since StateFields operate on the full document.
 */
function findTablesFromState(state: EditorState): TableRange[] {
  const tables: TableRange[] = [];
  const seen = new Set<number>();
  const doc = state.doc;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      if (seen.has(node.from)) return;
      seen.add(node.from);

      const tableFrom = node.from;
      const tableTo = node.to;

      const startLine = doc.lineAt(tableFrom);
      const endLine = doc.lineAt(tableTo);
      const lines: string[] = [];
      for (let ln = startLine.number; ln <= endLine.number; ln++) {
        lines.push(doc.line(ln).text);
      }

      const parsed = parseTable(lines);
      if (!parsed) return;

      const sepLine = doc.line(startLine.number + 1);
      const separatorFrom = sepLine.from;
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
  return tables;
}

/**
 * Build table decorations from EditorState.
 *
 * For each table: always replace with a rendered HTML <table> via TableWidget.
 * Cell editing happens via InlineEditor within the widget.
 */
function buildTableDecorationsFromState(state: EditorState): DecorationSet {
  const tables = findTablesFromState(state);
  const macros = state.field(mathMacrosField);
  const items: Range<Decoration>[] = [];

  for (const table of tables) {
    // Always render as HTML table widget — never show raw source.
    // Cell editing happens via contenteditable within the widget.
    const tableText = state.sliceDoc(table.from, table.to);
    const widget = new TableWidget(table.parsed, tableText, table.from, macros);

    items.push(
      Decoration.replace({
        widget,
        block: true,
      }).range(table.from, table.to),
    );
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides table rendering decorations.
 *
 * Uses a StateField (not ViewPlugin) so that block-level replace decorations
 * (which cross line breaks) are permitted by CM6.
 */
const tableDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorationsFromState(state);
  },

  update(value, tr) {
    // When the change came from a contenteditable cell sync, map
    // positions through the change instead of rebuilding. This keeps
    // the widget alive so the user can keep editing without the DOM
    // being destroyed and recreated.
    if (tr.annotation(cellEditAnnotation)) {
      return value.map(tr.changes);
    }

    if (
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      return buildTableDecorationsFromState(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

// ---------------------------------------------------------------------------
// Context menu event handler (standalone extension)
// ---------------------------------------------------------------------------

/** Standalone DOM event handler for table context menus. */
const tableContextMenuHandler: Extension = EditorView.domEventHandlers({
  contextmenu(event: MouseEvent, view: EditorView) {
    const tables = findTables(view);
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const table = findTableAtCursor(tables, pos);
    if (!table) return false;

    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    showTableContextMenu(view, table, event.clientX, event.clientY);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Keybindings
// ---------------------------------------------------------------------------

/** ArrowLeft: at cell start, jump to end of previous cell. */
function arrowLeft(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds) return false;

  // Only intercept at cell start
  if (cursorPos !== bounds.from) return false;

  const lineIdx = line.number - table.startLineNumber;
  let prevLineIdx = lineIdx;
  let prevColIdx = colIdx - 1;

  if (prevColIdx < 0) {
    // Wrap to last cell of previous row
    prevColIdx = table.parsed.header.cells.length - 1;
    prevLineIdx = skipSeparator(prevLineIdx - 1, -1);
  }

  if (prevLineIdx < 0) return false; // At very start of table

  const targetLineNum = table.startLineNumber + prevLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, prevColIdx);
  if (targetBounds) {
    view.dispatch({ selection: { anchor: targetBounds.to } });
  }
  return true;
}

/** ArrowRight: at cell end, jump to start of next cell. */
function arrowRight(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds) return false;

  // Only intercept at cell end
  if (cursorPos !== bounds.to) return false;

  const lineIdx = line.number - table.startLineNumber;
  const colCount = table.parsed.header.cells.length;
  let nextLineIdx = lineIdx;
  let nextColIdx = colIdx + 1;

  if (nextColIdx >= colCount) {
    // Wrap to first cell of next row
    nextColIdx = 0;
    nextLineIdx = skipSeparator(nextLineIdx + 1, 1);
  }

  const totalLines = table.lines.length;
  if (nextLineIdx >= totalLines) return false; // At very end of table

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, nextColIdx);
  if (targetBounds) {
    view.dispatch({ selection: { anchor: targetBounds.from } });
  }
  return true;
}

/** ArrowUp: move to same column in previous row. */
function arrowUp(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const lineIdx = line.number - table.startLineNumber;

  const prevLineIdx = skipSeparator(lineIdx - 1, -1);
  if (prevLineIdx < 0) return false; // Already on header row

  const targetLineNum = table.startLineNumber + prevLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, colIdx);
  if (targetBounds) {
    // Clamp cursor to cell content range
    const offset = cursorPos - (findCellBounds(line.text, line.from, colIdx)?.from ?? cursorPos);
    const clamped = Math.min(targetBounds.from + offset, targetBounds.to);
    view.dispatch({ selection: { anchor: clamped } });
  }
  return true;
}

/** ArrowDown: move to same column in next row. */
function arrowDown(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;
  const doc = view.state.doc;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = doc.lineAt(cursorPos);
  const lineIdx = line.number - table.startLineNumber;

  const nextLineIdx = skipSeparator(lineIdx + 1, 1);
  if (nextLineIdx >= table.lines.length) return false; // Already on last row

  const targetLineNum = table.startLineNumber + nextLineIdx;
  const targetLine = doc.line(targetLineNum);
  const targetBounds = findCellBounds(targetLine.text, targetLine.from, colIdx);
  if (targetBounds) {
    // Clamp cursor to cell content range
    const offset = cursorPos - (findCellBounds(line.text, line.from, colIdx)?.from ?? cursorPos);
    const clamped = Math.min(targetBounds.from + offset, targetBounds.to);
    view.dispatch({ selection: { anchor: clamped } });
  }
  return true;
}

/** Backspace: prevent deleting at cell start (would destroy pipe). */
function backspaceStop(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;

  // Only intercept when there's no selection
  if (!view.state.selection.main.empty) return false;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = view.state.doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds) return false;

  // At start of cell content — consume the event
  if (cursorPos === bounds.from) return true;

  return false;
}

/** Delete: prevent deleting at cell end (would destroy pipe). */
function deleteStop(view: EditorView): boolean {
  const tables = findTables(view);
  const cursorPos = view.state.selection.main.head;

  // Only intercept when there's no selection
  if (!view.state.selection.main.empty) return false;

  const table = findTableAtCursor(tables, cursorPos);
  if (!table) return false;

  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const line = view.state.doc.lineAt(cursorPos);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (!bounds) return false;

  // At end of cell content — consume the event
  if (cursorPos === bounds.to) return true;

  return false;
}

/** Table-specific keybindings. Must be high-precedence to override defaults. */
const tableKeybindings: Extension = Prec.high(
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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** CM6 extension for interactive table editing. */
export const tableRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mathMacrosField,
  tableDecorationField,
  tableContextMenuHandler,
  tableKeybindings,
];

// ---------------------------------------------------------------------------
// TableWidget — HTML table rendering for Decoration.replace mode (#205)
// ---------------------------------------------------------------------------

/**
 * Widget that renders a markdown table as an HTML <table> element.
 *
 * Used with Decoration.replace to show a rendered table. Cells display
 * rendered inline markdown by default. On click, an InlineEditor (nested
 * CM6 instance) is created inside the cell for Typora-style editing:
 * math renders with KaTeX, bold/italic markers are hidden when the
 * cursor is not adjacent, and the cell has its own undo/redo stack.
 * Only one cell editor is active at a time.
 */
export class TableWidget extends WidgetType {
  /** Reference to the EditorView, stored on first toDOM() call. */
  private editorView: EditorView | null = null;

  constructor(
    private readonly table: ParsedTable,
    private readonly tableText: string,
    private readonly tableFrom: number,
    private readonly macros: Record<string, string>,
  ) {
    super();
  }

  /**
   * Content-based equality check for DOM reuse.
   * If the table text changed, CM6 will rebuild the DOM via toDOM().
   */
  eq(other: TableWidget): boolean {
    return this.tableText === other.tableText;
  }

  /**
   * Return the raw markdown text for a cell given its section and indices.
   */
  private getRawCellText(section: string, row: number, col: number): string {
    if (section === "header") {
      return col < this.table.header.cells.length
        ? this.table.header.cells[col].content
        : "";
    }
    if (row < this.table.rows.length && col < this.table.rows[row].cells.length) {
      return this.table.rows[row].cells[col].content;
    }
    return "";
  }

  /**
   * Build a new ParsedTable with one cell replaced.
   */
  private buildUpdatedTable(
    section: string,
    row: number,
    col: number,
    newContent: string,
  ): ParsedTable {
    if (section === "header") {
      const cells = this.table.header.cells.map((c, i) =>
        i === col ? { content: newContent } : c,
      );
      return { ...this.table, header: { cells } };
    }
    const rows = this.table.rows.map((r, ri) => {
      if (ri !== row) return r;
      const cells = r.cells.map((c, ci) =>
        ci === col ? { content: newContent } : c,
      );
      return { cells };
    });
    return { ...this.table, rows };
  }

  /**
   * Render the parsed table as an HTML <table> with thead/tbody.
   * Each cell gets data attributes for row, column, and section,
   * and inline markdown rendering. Clicking a cell creates an InlineEditor.
   */
  toDOM(view: EditorView): HTMLElement {
    this.editorView = view;

    const container = document.createElement("div");
    container.className = "cg-table-widget";
    container.dataset.tableTextHash = this.tableText;
    container.dataset.tableFrom = String(this.tableFrom);

    const tableEl = document.createElement("table");

    // ── Shared cell setup ─────────────────────────────────────────────
    // Cells are NOT contenteditable by default — they show rendered markdown.
    // On click, an InlineEditor is created inside the cell (one at a time).

    /**
     * Activate a target cell by dispatching a synthetic mousedown.
     * Used for Tab/Enter/Arrow navigation between cells.
     */
    const activateTargetCell = (
      linearRow: number,
      targetCol: number,
      placeAtEnd = false,
    ): void => {
      const targetSection = linearRow === 0 ? "header" : "body";
      const targetRow = linearRow === 0 ? 0 : linearRow - 1;
      const target = tableEl.querySelector(
        `[data-section="${targetSection}"][data-row="${targetRow}"][data-col="${targetCol}"]`,
      ) as HTMLElement | null;
      if (target) {
        // Store placement hint on the element for the mousedown handler
        target.dataset.placeAtEnd = placeAtEnd ? "true" : "false";
        target.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
      }
    };

    /**
     * Sync edited text to the root document.
     * @param useAnnotation - When true, uses cellEditAnnotation to prevent widget rebuild.
     */
    const syncToRoot = (
      editedSection: string,
      editedRow: number,
      editedCol: number,
      editedText: string,
      useAnnotation: boolean,
    ): void => {
      const rootView = this.editorView;
      if (!rootView) return;
      const currentTables = findTablesFromState(rootView.state);
      const currentTable = currentTables.find(
        (t) => Math.abs(t.from - this.tableFrom) < 50,
      );
      if (!currentTable) return;
      const currentText = rootView.state.sliceDoc(currentTable.from, currentTable.to);
      const updated = this.buildUpdatedTable(editedSection, editedRow, editedCol, editedText);
      if (!updated) return;
      const newText = formatTable(updated).join("\n");
      if (newText === currentText) return;
      rootView.dispatch({
        changes: { from: currentTable.from, to: currentTable.to, insert: newText },
        ...(useAnnotation ? { annotations: cellEditAnnotation.of(true) } : {}),
      });
    };

    const setupCell = (
      cell: HTMLElement,
      section: string,
      row: number,
      col: number,
      content: string,
    ): void => {
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.dataset.section = section;

      // Apply column alignment
      const align = this.table.alignments[col];
      if (align && align !== "none") {
        cell.style.textAlign = align;
      }

      // Initial render: show inline markdown (no editor yet)
      renderInlineMarkdown(cell, content, this.macros);

      // ── Click: create an InlineEditor in this cell ─────────────────
      cell.addEventListener("mousedown", (e) => {
        // If this cell already has the editor, let it handle the click
        if (activeInlineEditor && activeInlineEditor.cell === cell) return;

        e.preventDefault();
        e.stopPropagation();

        // Capture click coordinates for caret placement
        const clickX = e.clientX;
        const clickY = e.clientY;

        // Read placement hint (set by activateTargetCell for navigation)
        const placeAtEnd = cell.dataset.placeAtEnd === "true";
        delete cell.dataset.placeAtEnd;

        // Destroy any existing editor (its onBlur won't fire because we
        // destroy synchronously before the new editor is created).
        if (activeInlineEditor) {
          const oldText = activeInlineEditor.view.state.doc.toString();
          const oldCell = activeInlineEditor.cell;
          const oldSection = oldCell.dataset.section ?? "body";
          const oldRow = parseInt(oldCell.dataset.row ?? "0", 10);
          const oldCol = parseInt(oldCell.dataset.col ?? "0", 10);
          destroyActiveInlineEditor();
          renderInlineMarkdown(oldCell, oldText, this.macros);
          // Sync old cell with annotation (we're staying in the table)
          syncToRoot(oldSection, oldRow, oldCol, oldText, true);
        }

        // Activate this cell
        const rawText = this.getRawCellText(section, row, col);
        cell.innerHTML = "";
        cell.classList.add("cg-table-cell-editing");

        const colCount = this.table.header.cells.length;
        const bodyRowCount = this.table.rows.length;
        const currentLinear = section === "header" ? 0 : row + 1;
        const totalRows = 1 + bodyRowCount;

        const editorView = createInlineEditor({
          parent: cell,
          doc: rawText,
          macros: this.macros,
          onChange: (newDoc) => {
            // Sync to root document per keystroke with cellEditAnnotation
            syncToRoot(section, row, col, newDoc, true);
          },
          onBlur: () => {
            // Delay to check if focus moved to another cell in same table
            setTimeout(() => {
              if (!activeInlineEditor || activeInlineEditor.cell !== cell) return;
              const editedText = destroyActiveInlineEditor();
              renderInlineMarkdown(cell, editedText, this.macros);

              // Final sync — check if focus is still in the table
              const widgetContainer = cell.closest(".cg-table-widget");
              const stillInTable =
                widgetContainer && widgetContainer.contains(document.activeElement);
              syncToRoot(section, row, col, editedText, !!stillInTable);
            }, 0);
          },
          onKeydown: (event) => {
            // ── Escape: exit cell editor, return to root CM6 ──────────
            if (event.key === "Escape") {
              event.preventDefault();
              const text = destroyActiveInlineEditor();
              renderInlineMarkdown(cell, text, this.macros);
              syncToRoot(section, row, col, text, false);
              this.editorView?.focus();
              return true;
            }

            // ── Tab: move to next/previous cell ───────────────────────
            if (event.key === "Tab" && !event.shiftKey) {
              event.preventDefault();
              let nextCol = col + 1;
              let nextLinear = currentLinear;
              if (nextCol >= colCount) {
                nextCol = 0;
                nextLinear++;
              }
              if (nextLinear >= totalRows) {
                // Past last cell: add a row, then focus first cell of new row
                const text = destroyActiveInlineEditor();
                renderInlineMarkdown(cell, text, this.macros);
                syncToRoot(section, row, col, text, true);
                const rootView = this.editorView;
                if (rootView) {
                  const tables = findTablesFromState(rootView.state);
                  const matchingTable = tables.find(
                    (t) => Math.abs(t.from - this.tableFrom) < 50,
                  );
                  if (matchingTable) {
                    applyTableMutation(rootView, matchingTable, (t) => addRow(t));
                  }
                  // After mutation, widget is rebuilt. Schedule focus on new row.
                  setTimeout(() => {
                    const containers = rootView.dom.querySelectorAll(".cg-table-widget");
                    for (const c of containers) {
                      const el = c as HTMLElement;
                      if (Math.abs(parseInt(el.dataset.tableFrom ?? "0", 10) - this.tableFrom) < 50) {
                        const newTarget = el.querySelector(
                          `[data-section="body"][data-row="${bodyRowCount}"][data-col="0"]`,
                        ) as HTMLElement | null;
                        if (newTarget) {
                          newTarget.dispatchEvent(
                            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
                          );
                        }
                        break;
                      }
                    }
                  }, 0);
                }
              } else {
                activateTargetCell(nextLinear, nextCol);
              }
              return true;
            }

            if (event.key === "Tab" && event.shiftKey) {
              event.preventDefault();
              let prevCol = col - 1;
              let prevLinear = currentLinear;
              if (prevCol < 0) {
                prevCol = colCount - 1;
                prevLinear--;
              }
              if (prevLinear < 0) return true; // Already at first cell
              activateTargetCell(prevLinear, prevCol, true);
              return true;
            }

            // ── Enter: move to same column, next row ──────────────────
            if (event.key === "Enter") {
              event.preventDefault();
              const nextLinear = currentLinear + 1;
              if (nextLinear >= totalRows) {
                // Add a row
                const text = destroyActiveInlineEditor();
                renderInlineMarkdown(cell, text, this.macros);
                syncToRoot(section, row, col, text, true);
                const rootView = this.editorView;
                if (rootView) {
                  const tables = findTablesFromState(rootView.state);
                  const matchingTable = tables.find(
                    (t) => Math.abs(t.from - this.tableFrom) < 50,
                  );
                  if (matchingTable) {
                    applyTableMutation(rootView, matchingTable, (t) => addRow(t));
                  }
                  setTimeout(() => {
                    const containers = rootView.dom.querySelectorAll(".cg-table-widget");
                    for (const c of containers) {
                      const el = c as HTMLElement;
                      if (Math.abs(parseInt(el.dataset.tableFrom ?? "0", 10) - this.tableFrom) < 50) {
                        const newTarget = el.querySelector(
                          `[data-section="body"][data-row="${bodyRowCount}"][data-col="${col}"]`,
                        ) as HTMLElement | null;
                        if (newTarget) {
                          newTarget.dispatchEvent(
                            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
                          );
                        }
                        break;
                      }
                    }
                  }, 0);
                }
              } else {
                activateTargetCell(nextLinear, col);
              }
              return true;
            }

            // ── Arrow navigation ──────────────────────────────────────
            if (!activeInlineEditor) return false;
            const pos = activeInlineEditor.view.state.selection.main.head;
            const len = activeInlineEditor.view.state.doc.length;

            if (event.key === "ArrowLeft" && pos === 0) {
              event.preventDefault();
              let prevCol = col - 1;
              let prevLinear = currentLinear;
              if (prevCol < 0) {
                prevCol = colCount - 1;
                prevLinear--;
              }
              if (prevLinear < 0) return true;
              activateTargetCell(prevLinear, prevCol, true);
              return true;
            }

            if (event.key === "ArrowRight" && pos === len) {
              event.preventDefault();
              let nextCol = col + 1;
              let nextLinear = currentLinear;
              if (nextCol >= colCount) {
                nextCol = 0;
                nextLinear++;
              }
              if (nextLinear >= totalRows) return true;
              activateTargetCell(nextLinear, nextCol);
              return true;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              const prevLinear = currentLinear - 1;
              if (prevLinear < 0) return true;
              activateTargetCell(prevLinear, col);
              return true;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              const nextLinear = currentLinear + 1;
              if (nextLinear >= totalRows) return true;
              activateTargetCell(nextLinear, col);
              return true;
            }

            // Prevent Backspace at position 0 and Delete at end
            if (event.key === "Backspace" && pos === 0) return true;
            if (event.key === "Delete" && pos === len) return true;

            return false;
          },
        });

        activeInlineEditor = { view: editorView, cell, tableWidget: this };

        // Place cursor at end if navigating backward, otherwise at start
        if (placeAtEnd) {
          const docLen = editorView.state.doc.length;
          editorView.dispatch({ selection: { anchor: docLen } });
        }
        editorView.focus();

        // Place caret near click position (skip for synthetic/keyboard navigation)
        if (e.isTrusted) {
          const pos = editorView.posAtCoords({ x: clickX, y: clickY });
          if (pos !== null) {
            editorView.dispatch({ selection: { anchor: pos } });
          } else {
            // Click outside content area — fall back to end of document
            const docLen = editorView.state.doc.length;
            editorView.dispatch({ selection: { anchor: docLen } });
          }
        }
      });
    };

    // ── Header ────────────────────────────────────────────────────────
    const thead = document.createElement("thead");
    const headerTr = document.createElement("tr");
    const headerCells = this.table.header.cells;

    for (let col = 0; col < headerCells.length; col++) {
      const th = document.createElement("th");
      setupCell(th, "header", 0, col, headerCells[col].content);
      headerTr.appendChild(th);
    }

    thead.appendChild(headerTr);
    tableEl.appendChild(thead);

    // ── Body ──────────────────────────────────────────────────────────
    const tbody = document.createElement("tbody");

    for (let row = 0; row < this.table.rows.length; row++) {
      const tr = document.createElement("tr");
      const rowCells = this.table.rows[row].cells;

      for (let col = 0; col < rowCells.length; col++) {
        const td = document.createElement("td");
        setupCell(td, "body", row, col, rowCells[col].content);
        tr.appendChild(td);
      }

      tbody.appendChild(tr);
    }

    tableEl.appendChild(tbody);

    // ── Context menu on right-click ──────────────────────────────────
    tableEl.addEventListener("contextmenu", (e: MouseEvent) => {
      // Walk up from the click target to find the cell with data attributes
      let target = e.target as HTMLElement | null;
      while (target && target !== tableEl) {
        if (target.dataset.col !== undefined) break;
        target = target.parentElement;
      }
      if (!target || target === tableEl || target.dataset.col === undefined) return;

      e.preventDefault();
      e.stopPropagation();

      const section = target.dataset.section ?? "body";
      const row = parseInt(target.dataset.row ?? "0", 10);
      const col = parseInt(target.dataset.col ?? "0", 10);

      // Re-parse the table from current document state
      const tables = findTablesFromState(view.state);
      const tableRange = tables.find((t) => t.from === this.tableFrom);
      if (!tableRange) return;

      showWidgetContextMenu(view, tableRange, section, row, col, e.clientX, e.clientY);
    });

    container.appendChild(tableEl);

    // ── ResizeObserver ────────────────────────────────────────────────
    // Notify CM6 when the rendered table height changes so scroll
    // positions and coordinate mappings stay accurate.
    const observer = new ResizeObserver(() => {
      view.requestMeasure();
    });
    observer.observe(container);

    return container;
  }

  /**
   * Return true so CM6 does NOT process events inside this widget.
   * The InlineEditor cells handle their own clicks, input, and
   * keyboard events. CM6 should not interfere.
   */
  ignoreEvent(): boolean {
    return true;
  }

  /**
   * Estimated height for CM6 scroll calculations.
   * Approximates based on row count: ~32px per row + ~40px header.
   */
  get estimatedHeight(): number {
    const rowCount = this.table.rows.length;
    return 40 + rowCount * 32;
  }
}
