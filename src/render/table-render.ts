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
  cursorInRange,
  RenderWidget,
  editorFocusField,
  focusEffect,
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
import type { Alignment, ParsedTable } from "./table-utils";
import { ContextMenu } from "../app/context-menu";
import type { ContextMenuItem } from "../app/context-menu";

// ---------------------------------------------------------------------------
// Cell-edit annotation — marks dispatches that originate from contenteditable
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
// Toolbar widget
// ---------------------------------------------------------------------------

/** Floating toolbar widget shown above an active table. */
class TableToolbarWidget extends RenderWidget {
  constructor(
    private readonly tableRange: TableRange,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "cg-table-toolbar";

    const makeBtn = (label: string, title: string, handler: () => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.className = "cg-table-toolbar-btn";
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        handler();
      });
      toolbar.appendChild(btn);
      return btn;
    };

    const makeSep = (): void => {
      const sep = document.createElement("div");
      sep.className = "cg-table-toolbar-sep";
      toolbar.appendChild(sep);
    };

    // ── Row/Column add/delete buttons ──────────────────────────────────

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

    makeSep();

    // ── Alignment buttons ──────────────────────────────────────────────

    const alignments: Array<{ label: string; title: string; value: Alignment }> = [
      { label: "\u2190", title: "Align left", value: "left" },
      { label: "\u2194", title: "Align center", value: "center" },
      { label: "\u2192", title: "Align right", value: "right" },
    ];

    for (const { label, title, value } of alignments) {
      const btn = makeBtn(label, title, () => {
        applyTableMutation(view, this.tableRange, (table) => {
          const cursorCol = getCursorColIndex(view, this.tableRange);
          if (cursorCol === null) return table;
          return setAlignment(table, cursorCol, value);
        });
      });

      // Highlight the active alignment for the current column
      const cursorCol = getCursorColIndex(view, this.tableRange);
      if (cursorCol !== null && this.tableRange.parsed.alignments[cursorCol] === value) {
        btn.classList.add("cg-table-toolbar-btn-active");
      }
    }

    makeSep();

    // ── Move Row/Column buttons ────────────────────────────────────────

    makeBtn("\u2191", "Move row up", () => {
      const cursorRow = getCursorRowIndex(view, this.tableRange);
      if (cursorRow === null || cursorRow <= 0) return;
      applyTableMutation(view, this.tableRange, (table) =>
        moveRow(table, cursorRow, cursorRow - 1),
      );
      // Move cursor up to follow the row
      const targetLineNum = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
      if (targetLineNum >= 1) {
        const targetLine = view.state.doc.line(targetLineNum);
        const cursorCol = getCursorColIndex(view, this.tableRange);
        const bounds = findCellBounds(targetLine.text, targetLine.from, cursorCol ?? 0);
        if (bounds) {
          view.dispatch({ selection: { anchor: bounds.from } });
        }
      }
    });

    makeBtn("\u2193", "Move row down", () => {
      const cursorRow = getCursorRowIndex(view, this.tableRange);
      if (cursorRow === null || cursorRow >= this.tableRange.parsed.rows.length - 1) return;
      applyTableMutation(view, this.tableRange, (table) =>
        moveRow(table, cursorRow, cursorRow + 1),
      );
      // Move cursor down to follow the row
      const targetLineNum = view.state.doc.lineAt(view.state.selection.main.head).number + 1;
      if (targetLineNum <= view.state.doc.lines) {
        const targetLine = view.state.doc.line(targetLineNum);
        const cursorCol = getCursorColIndex(view, this.tableRange);
        const bounds = findCellBounds(targetLine.text, targetLine.from, cursorCol ?? 0);
        if (bounds) {
          view.dispatch({ selection: { anchor: bounds.from } });
        }
      }
    });

    makeBtn("\u2190", "Move column left", () => {
      const cursorCol = getCursorColIndex(view, this.tableRange);
      if (cursorCol === null || cursorCol <= 0) return;
      applyTableMutation(view, this.tableRange, (table) =>
        moveColumn(table, cursorCol, cursorCol - 1),
      );
    });

    makeBtn("\u2192", "Move column right", () => {
      const cursorCol = getCursorColIndex(view, this.tableRange);
      if (cursorCol === null || cursorCol >= this.tableRange.parsed.header.cells.length - 1) return;
      applyTableMutation(view, this.tableRange, (table) =>
        moveColumn(table, cursorCol, cursorCol + 1),
      );
    });

    return toolbar;
  }

  eq(other: TableToolbarWidget): boolean {
    return (
      this.tableRange.from === other.tableRange.from &&
      this.tableRange.to === other.tableRange.to
    );
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
 * For each table:
 * - If cursor is inside (and editor is focused): show toolbar widget only
 *   (raw source is visible for editing).
 * - If cursor is outside: replace the entire table with a rendered HTML
 *   <table> via TableWidget.
 */
function buildTableDecorationsFromState(state: EditorState, focused: boolean): DecorationSet {
  const tables = findTablesFromState(state);
  const macros = state.field(mathMacrosField);
  const items: Range<Decoration>[] = [];

  for (const table of tables) {
    const insideCursor = focused && cursorInRange(state, table.from, table.to);

    if (insideCursor) {
      // Cursor inside: show raw source + toolbar
      items.push(
        Decoration.widget({
          widget: new TableToolbarWidget(table),
          side: -1,
        }).range(table.from),
      );
    } else {
      // Cursor outside: replace entire table with rendered HTML table
      const tableText = state.sliceDoc(table.from, table.to);
      const widget = new TableWidget(table.parsed, tableText, table.from, macros);

      items.push(
        Decoration.replace({
          widget,
          block: true,
        }).range(table.from, table.to),
      );
    }
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
    return buildTableDecorationsFromState(state, false);
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
      tr.selection ||
      tr.effects.some((e) => e.is(focusEffect)) ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    ) {
      const focused = tr.state.field(editorFocusField, false) ?? false;
      return buildTableDecorationsFromState(tr.state, focused);
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
 * Used with Decoration.replace to show a rendered table when the cursor
 * is outside the table's source range. Cells are contenteditable so
 * users can click and type directly. On focus, rendered content is
 * replaced with raw markdown; on blur, the edit syncs back to the
 * source document and the cell re-renders inline markdown.
 *
 * Cell content is rendered via renderInlineMarkdown so math, bold,
 * and italic work inside table cells.
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
   * Sync cell content back to the CM6 document.
   * Uses the cellEditAnnotation to prevent StateField rebuild.
   */
  private syncToDocument(
    section: string,
    row: number,
    col: number,
    newContent: string,
  ): void {
    const view = this.editorView;
    if (!view) return;

    const updatedTable = this.buildUpdatedTable(section, row, col, newContent);
    const newLines = formatTable(updatedTable);
    const newText = newLines.join("\n");

    // Don't dispatch if nothing changed
    if (newText === this.tableText) return;

    view.dispatch({
      changes: { from: this.tableFrom, to: this.tableFrom + this.tableText.length, insert: newText },
      annotations: cellEditAnnotation.of(true),
    });
  }

  /**
   * Render the parsed table as an HTML <table> with thead/tbody.
   * Each cell gets data attributes for row, column, and section,
   * contenteditable for direct editing, and inline markdown rendering.
   */
  toDOM(view: EditorView): HTMLElement {
    this.editorView = view;

    const container = document.createElement("div");
    container.className = "cg-table-widget";
    container.dataset.tableTextHash = this.tableText;
    container.dataset.tableFrom = String(this.tableFrom);

    const tableEl = document.createElement("table");

    // ── Shared cell setup ─────────────────────────────────────────────
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
      cell.contentEditable = "true";

      // Apply column alignment
      const align = this.table.alignments[col];
      if (align && align !== "none") {
        cell.style.textAlign = align;
      }

      // Initial render: show inline markdown
      renderInlineMarkdown(cell, content, this.macros);

      // ── Focus: switch to raw markdown for editing ─────────────────
      cell.addEventListener("focusin", () => {
        cell.classList.add("cg-table-cell-editing");
        const rawText = this.getRawCellText(section, row, col);
        cell.textContent = rawText;
      });

      // ── Blur: sync edit back and re-render ────────────────────────
      cell.addEventListener("focusout", () => {
        cell.classList.remove("cg-table-cell-editing");
        const editedText = (cell.textContent ?? "").trim();
        // Sync to document
        this.syncToDocument(section, row, col, editedText);
        // Re-render inline markdown
        cell.innerHTML = "";
        renderInlineMarkdown(cell, editedText, this.macros);
      });

      // ── Keydown handlers ──────────────────────────────────────────
      cell.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          // Blur the cell, return focus to CM6
          e.preventDefault();
          cell.blur();
          view.focus();
        } else if (e.key === "Enter") {
          // Prevent <br> insertion
          e.preventDefault();
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
   * The contenteditable cells handle their own clicks, input, and
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
