/**
 * CM6 ViewPlugin for interactive table rendering.
 *
 * Behavior:
 * - Pipe characters are always hidden (cg-hidden mark, zero-width CSS).
 * - Separator row is always hidden via Decoration.replace.
 * - Each cell's content is wrapped in a cg-table-col mark with CSS borders
 *   to create a visual grid.
 * - Cursor INSIDE table: show floating toolbar (add/delete row/col),
 *   enable Tab/Enter navigation.
 * - Auto-format after cell edits via transactions.
 *
 * Inline markdown (math, bold, etc.) works inside table cells because
 * we use Decoration.mark (not replace) for styling.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type Extension,
  type Range,
  Prec,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { buildDecorations, decorationHidden, RenderWidget } from "./render-utils";
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
// ViewPlugin
// ---------------------------------------------------------------------------

class TableRenderPluginValue implements PluginValue {
  decorations: DecorationSet;

  /** Injected <style> element for dynamic column widths. */
  private styleEl: HTMLStyleElement;
  /** Last generated CSS — skip DOM write if unchanged. */
  private lastCSS = "";
  /** Guard against redundant rAF scheduling. */
  private measureScheduled = false;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
    this.styleEl = document.createElement("style");
    this.styleEl.setAttribute("data-cg-table-columns", "");
    document.head.appendChild(this.styleEl);
    this.scheduleMeasure(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.decorations = this.buildDecorations(update.view);
    }

    // Only re-measure when layout may have changed
    if (update.docChanged || update.geometryChanged || update.viewportChanged) {
      this.scheduleMeasure(update.view);
    }
  }

  destroy(): void {
    this.styleEl.remove();
  }

  // ── Column width measurement ────────────────────────────────────────

  /**
   * Schedule a single rAF to measure column widths after the browser
   * has painted the new decorations.
   */
  private scheduleMeasure(view: EditorView): void {
    if (this.measureScheduled) return;
    this.measureScheduled = true;
    requestAnimationFrame(() => {
      this.measureScheduled = false;
      this.measureAndInjectCSS(view);
    });
  }

  /**
   * Measure the offsetWidth of every `.cg-table-col` span, compute
   * the maximum width per column per table, and inject CSS min-width
   * rules via the shared <style> element.
   */
  private measureAndInjectCSS(view: EditorView): void {
    // Clear existing min-width CSS before measuring so offsetWidth returns
    // natural content width, not the previous min-width value.
    this.styleEl.textContent = "";

    const dom = view.dom;
    const colSpans = dom.querySelectorAll<HTMLElement>(".cg-table-col");

    // Collect max width per column per table: { tableId: { colIdx: maxWidth } }
    const widths = new Map<string, Map<number, number>>();

    for (const span of colSpans) {
      const tableId = span.getAttribute("data-table-id");
      const colStr = span.getAttribute("data-col");
      if (tableId === null || colStr === null) continue;

      const colIdx = Number(colStr);
      const width = span.offsetWidth + 1; // +1 for sub-pixel rounding

      let tableWidths = widths.get(tableId);
      if (!tableWidths) {
        tableWidths = new Map<number, number>();
        widths.set(tableId, tableWidths);
      }

      const current = tableWidths.get(colIdx) ?? 0;
      if (width > current) {
        tableWidths.set(colIdx, width);
      }
    }

    // Generate CSS rules
    const rules: string[] = [];
    for (const [tableId, tableWidths] of widths) {
      for (const [colIdx, width] of tableWidths) {
        rules.push(
          `[data-table-id="${tableId}"].cg-table-col-${colIdx} { min-width: ${width}px }`,
        );
      }
    }

    const css = rules.join("\n");
    if (css !== this.lastCSS) {
      this.styleEl.textContent = css;
      this.lastCSS = css;
    }
  }

  // ── Decoration building ─────────────────────────────────────────────

  private buildDecorations(view: EditorView): DecorationSet {
    const tables = findTables(view);
    const cursor = view.state.selection.main;
    const hasFocus = view.hasFocus;
    const doc = view.state.doc;

    const items: Range<Decoration>[] = [];

    for (let tableIdx = 0; tableIdx < tables.length; tableIdx++) {
      const table = tables[tableIdx];
      const tableId = String(tableIdx);
      const cursorInTable =
        hasFocus && cursor.from >= table.from && cursor.to <= table.to;

      // Always apply table wrapper styling
      items.push(tableMarkDecoration.range(table.from, table.to));

      // Toolbar: shown when cursor is in table
      if (cursorInTable) {
        items.push(
          Decoration.widget({
            widget: new TableToolbarWidget(table),
            side: -1,
          }).range(table.from),
        );
      }

      // Separator row: ALWAYS hidden via Decoration.replace
      const sepLine = doc.lineAt(table.separatorFrom);
      items.push(
        Decoration.replace({}).range(sepLine.from, sepLine.to),
      );

      // Style header row
      const headerLine = doc.line(table.startLineNumber);
      items.push(
        headerMarkDecoration.range(headerLine.from, headerLine.to),
      );

      // Process all rows (except separator) for pipe hiding + column wrapping
      const endLine = doc.lineAt(table.to);
      const separatorLineNumber = table.startLineNumber + 1;

      for (let ln = table.startLineNumber; ln <= endLine.number; ln++) {
        // Skip separator row — it's fully hidden
        if (ln === separatorLineNumber) continue;

        const line = doc.line(ln);
        const pipes = findPipePositions(line.text);

        // Hide ALL pipe characters via cg-hidden
        for (const p of pipes) {
          items.push(
            decorationHidden.range(line.from + p, line.from + p + 1),
          );
        }

        // Wrap each cell content in cg-table-col cg-table-col-N
        // Cells are between consecutive pipes: pipe[i]+1 .. pipe[i+1]
        // data-table-id scopes column widths per table
        for (let i = 0; i < pipes.length - 1; i++) {
          const cellStart = line.from + pipes[i] + 1;
          const cellEnd = line.from + pipes[i + 1];

          // Only create mark if cell has content (non-empty range)
          if (cellStart < cellEnd) {
            items.push(
              Decoration.mark({
                class: `cg-table-col cg-table-col-${i}`,
                attributes: {
                  "data-col": String(i),
                  "data-table-id": tableId,
                },
              }).range(cellStart, cellEnd),
            );
          }
        }
      }
    }

    return buildDecorations(items);
  }
}

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
  ViewPlugin.fromClass(TableRenderPluginValue, {
    decorations: (v) => v.decorations,
    eventHandlers: {
      contextmenu(event: MouseEvent, view: EditorView) {
        // Check if the right-click is inside a table
        const tables = findTables(view);
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const table = findTableAtCursor(tables, pos);
        if (!table) return false;

        event.preventDefault();
        // Place cursor at the right-click position so row/col detection works
        view.dispatch({ selection: { anchor: pos } });
        showTableContextMenu(view, table, event.clientX, event.clientY);
        return true;
      },
    },
  }),
  tableKeybindings,
];
