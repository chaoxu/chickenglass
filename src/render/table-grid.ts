/**
 * Decoration-based table rendering using CSS grid.
 *
 * Table markdown stays in the document as normal text. Decorations transform
 * the visual presentation into a grid:
 * - Pipe characters → hidden (Decoration.replace)
 * - Cell content → wrapped in grid-item marks (Decoration.mark)
 * - Separator row → hidden (Decoration.line)
 * - Table lines → CSS grid layout (Decoration.line)
 *
 * Cell content is rendered by CM6's own inline extensions (math, citations,
 * highlights, bold, etc.) — no separate renderInlineMarkdown needed.
 * Editing happens directly in the grid cells with no display/edit mode switch.
 *
 * Structural protection:
 * - Pipes, padding spaces, and row newlines are immutable
 * - Cursor skips structural zones via EditorView.atomicRanges
 * - Copy strips pipes; paste flattens to single-line inline content
 * - Tab/Arrow navigation between cells
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import { Annotation, EditorState, RangeSetBuilder, type RangeSet } from "@codemirror/state";
import {
  tableDiscoveryField,
  findTablesInState,
  findTableAtCursor,
  findPipePositions,
  getCursorColIndex,
  getCursorRowIndex,
  type TableRange,
} from "./table-discovery";
import { createSimpleTextWidget } from "./render-core";
import { ContextMenu } from "../lib/context-menu";
import type { ContextMenuItem } from "../lib/context-menu";
import { programmaticDocumentChangeAnnotation } from "../editor/programmatic-document-change";
import {
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  setAlignment,
  moveRow,
  moveColumn,
  formatTable,
  type ParsedTable,
} from "./table-utils";

// ---------------------------------------------------------------------------
// Bypass annotation — table operations dispatch with this so the
// pipeProtectionFilter allows the structural change through.
// ---------------------------------------------------------------------------

/**
 * Annotation attached to table-operation transactions so that the
 * pipeProtectionFilter lets them through unblocked.
 */
export const tableOperationAnnotation = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// Decorations (module-level singletons)
// ---------------------------------------------------------------------------

const pipeReplace = Decoration.replace({
  widget: createSimpleTextWidget("span", "cf-grid-pipe", ""),
});
/** Create a cell mark for a specific column. Cached per column index. */
const cellMarkCache = new Map<string, Decoration>();
function cellMarkForCol(col: number, isHeader: boolean): Decoration {
  const key = `${col}-${isHeader}`;
  let mark = cellMarkCache.get(key);
  if (!mark) {
    const cls = isHeader ? "cf-grid-cell cf-grid-cell-header" : "cf-grid-cell";
    mark = Decoration.mark({
      class: cls,
      inclusive: true,
      attributes: { "data-col": String(col) },
    });
    cellMarkCache.set(key, mark);
  }
  return mark;
}
const separatorLine = Decoration.line({ class: "cf-grid-separator" });

function gridRowLine(columns: number, isHeader: boolean, isLast: boolean): Decoration {
  const classes = [
    "cf-grid-row",
    isHeader ? "cf-grid-header" : "cf-grid-body",
    isLast ? "cf-grid-row-last" : "",
  ].filter(Boolean).join(" ");
  return Decoration.line({
    class: classes,
    attributes: {
      style: `display: grid; grid-template-columns: repeat(${columns}, 1fr);`,
    },
  });
}

// ---------------------------------------------------------------------------
// Cell bounds — editable content zones within table rows
// ---------------------------------------------------------------------------

interface CellBounds {
  from: number;
  to: number;
  col: number;
}

/** Compute editable bounds for all cells on a table line. */
function getCellBounds(line: { from: number; text: string }, pipes: number[]): CellBounds[] {
  const cells: CellBounds[] = [];
  for (let i = 0; i < pipes.length - 1; i++) {
    const rawStart = pipes[i] + 1;
    const rawEnd = pipes[i + 1];
    let start = rawStart;
    while (start < rawEnd && line.text[start] === " ") start++;
    let end = rawEnd;
    while (end > start && line.text[end - 1] === " ") end--;
    if (start >= rawEnd) { start = rawStart + 1; end = start; }
    cells.push({ from: line.from + start, to: line.from + end, col: i });
  }
  return cells;
}

/** Find which cell a document position falls in. Returns the cell and full cells array. */
function findCellAtPos(
  pos: number,
  line: { from: number; text: string },
  pipes: number[],
): { cell: CellBounds; cells: CellBounds[] } | null {
  const cells = getCellBounds(line, pipes);
  const posInLine = pos - line.from;
  for (const cell of cells) {
    const rawStart = pipes[cell.col] + 1;
    const rawEnd = pipes[cell.col + 1];
    if (posInLine >= rawStart && posInLine <= rawEnd) return { cell, cells };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Table lookup helpers
// ---------------------------------------------------------------------------

const SEPARATOR_RE = /^\s*\|[\s:-]+\|/;

function isSeparatorRow(text: string): boolean {
  return SEPARATOR_RE.test(text);
}

function adjacentTableLine(
  doc: { lines: number; line(n: number): { from: number; to: number; text: string; number: number } },
  lineNum: number,
  direction: 1 | -1,
): { from: number; to: number; text: string; number: number } | null {
  const target = lineNum + direction;
  if (target < 1 || target > doc.lines) return null;
  const line = doc.line(target);
  if (isSeparatorRow(line.text)) {
    const skip = target + direction;
    if (skip < 1 || skip > doc.lines) return null;
    return doc.line(skip);
  }
  return line;
}

/** Check if pos is in a structural zone. Uses pre-computed tables to avoid tree walks. */
function isStructuralAt(
  state: EditorState,
  pos: number,
  tables: readonly TableRange[],
): boolean {
  if (!findTableAtCursor(tables, pos)) return false;
  const line = state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  if (pipes.length < 2) return false;
  const result = findCellAtPos(pos, line, pipes);
  if (!result) return true; // on a pipe
  return pos < result.cell.from || pos > result.cell.to;
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

/** Sentinel decoration used solely to mark atomic (non-editable) spans.
 *  atomicRanges accepts any RangeSet, so we reuse Decoration.mark. */
const atomicMark = Decoration.mark({});

interface TableGridArtifacts {
  readonly structuralDecorations: DecorationSet;
  readonly cellDecorations: DecorationSet;
  readonly atomicRanges: RangeSet<Decoration>;
}

/**
 * Build all table grid artifacts from the shared table cache in one pass.
 *
 * The table subsystem used to rediscover tables and rewalk the syntax tree
 * three times here (structure, cells, atomic ranges). That multiplied the
 * cost of every document-level table update. The shared state field already
 * owns table discovery, so this layer now derives all view artifacts from the
 * cached TableRange array in one linear pass.
 */
function buildTableGridArtifacts(state: EditorState): TableGridArtifacts {
  const structuralBuilder = new RangeSetBuilder<Decoration>();
  const cellBuilder = new RangeSetBuilder<Decoration>();
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (const table of findTablesInState(state)) {
    const columns = table.parsed.header.cells.length;
    if (columns < 1) continue;

    for (let lineIndex = 0; lineIndex < table.lines.length; lineIndex += 1) {
      const lineNumber = table.startLineNumber + lineIndex;
      const line = doc.line(lineNumber);

      if (lineIndex === 1) {
        structuralBuilder.add(line.from, line.from, separatorLine);
        if (line.from < line.to) {
          atomicBuilder.add(line.from, line.to, atomicMark);
        }
        continue;
      }

      const isHeader = lineIndex === 0;
      const isLast = lineIndex === table.lines.length - 1;
      structuralBuilder.add(line.from, line.from, gridRowLine(columns, isHeader, isLast));

      const pipes = findPipePositions(line.text);
      if (pipes.length < 2) continue;

      for (const pipeOffset of pipes) {
        structuralBuilder.add(line.from + pipeOffset, line.from + pipeOffset + 1, pipeReplace);
      }

      for (let col = 0; col < pipes.length - 1; col += 1) {
        const cellStart = line.from + pipes[col] + 1;
        const cellEnd = line.from + pipes[col + 1];
        if (cellEnd > cellStart) {
          cellBuilder.add(cellStart, cellEnd, cellMarkForCol(col, isHeader));
        }
      }

      const cells = getCellBounds(line, pipes);
      let cursor = 0;
      for (const cell of cells) {
        const cellFromOff = cell.from - line.from;
        const cellToOff = cell.to - line.from;
        if (cellFromOff > cursor) {
          atomicBuilder.add(line.from + cursor, line.from + cellFromOff, atomicMark);
        }
        cursor = cellToOff;
      }
      if (cursor < line.text.length) {
        atomicBuilder.add(line.from + cursor, line.to, atomicMark);
      }
    }
  }

  return {
    structuralDecorations: structuralBuilder.finish(),
    cellDecorations: cellBuilder.finish(),
    atomicRanges: atomicBuilder.finish(),
  };
}

function tableDiscoveryChanged(update: ViewUpdate): boolean {
  return (
    update.state.field(tableDiscoveryField, false)
    !== update.startState.field(tableDiscoveryField, false)
  );
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

function handleCopy(event: ClipboardEvent, view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const pos = view.state.selection.main.head;
  if (!findTableAtCursor(tables, pos)) return false;

  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  let text = view.state.sliceDoc(from, to);
  text = text.replace(/(?<!\\)\|/g, "");
  text = text.replace(/  +/g, " ").trim();

  event.clipboardData?.setData("text/plain", text);
  event.preventDefault();
  return true;
}

function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const pos = view.state.selection.main.head;
  if (!findTableAtCursor(tables, pos)) return false;

  const raw = event.clipboardData?.getData("text/plain");
  if (!raw) return false;

  // Strip block syntax per-line, then flatten
  const text = raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>{1,}\s*/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^:::.*/, "")
        .replace(/^```.*$/, ""),
    )
    .join(" ")
    .replace(/\|/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text) view.dispatch(view.state.replaceSelection(text));
  event.preventDefault();
  return true;
}

const tableClipboardHandlers = EditorView.domEventHandlers({
  copy(event, view) { return handleCopy(event, view); },
  cut(event, view) {
    if (handleCopy(event, view)) {
      view.dispatch(view.state.replaceSelection(""));
      return true;
    }
    return false;
  },
  paste(event, view) { return handlePaste(event, view); },
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function moveVertical(view: EditorView, direction: 1 | -1): boolean {
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
  const targetCell = targetCells.find(c => c.col === result.cell.col);
  if (!targetCell) return false;

  const offset = Math.min(offsetInCell, targetCell.to - targetCell.from);
  view.dispatch({ selection: { anchor: targetCell.from + offset } });
  return true;
}

function findNextCell(view: EditorView, forward: boolean): number | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  const result = findCellAtPos(pos, line, pipes);
  if (!result) return null;

  const dir = forward ? 1 : -1;
  const adjacent = result.cells.find(c => c.col === result.cell.col + dir);
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

function cursorInTableCheck(view: EditorView): boolean {
  return findTableAtCursor(findTablesInState(view.state), view.state.selection.main.head) !== null;
}

const tableKeyBindings: KeyBinding[] = [
  { key: "Enter", run: cursorInTableCheck },
  {
    key: "Tab",
    run(view) {
      if (!cursorInTableCheck(view)) return false;
      const next = findNextCell(view, true);
      if (next !== null) { view.dispatch({ selection: { anchor: next } }); return true; }
      return false;
    },
  },
  {
    key: "Shift-Tab",
    run(view) {
      if (!cursorInTableCheck(view)) return false;
      const prev = findNextCell(view, false);
      if (prev !== null) { view.dispatch({ selection: { anchor: prev } }); return true; }
      return false;
    },
  },
  { key: "ArrowUp", run: (view) => moveVertical(view, -1) },
  { key: "ArrowDown", run: (view) => moveVertical(view, 1) },
  { key: "Backspace", run: deleteSelectedTableSelection },
  { key: "Delete", run: deleteSelectedTableSelection },
];

// ---------------------------------------------------------------------------
// Structure protection
// ---------------------------------------------------------------------------

const pipeProtectionFilter = EditorState.transactionFilter.of((tr) => {
  // Table operations bypass all protection — they rebuild the full table text.
  if (tr.annotation(tableOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  if (tr.docChanged) {
    const state = tr.startState;
    const doc = state.doc;
    const tables = findTablesInState(state);
    if (tables.length === 0) return tr; // fast path: no tables

    let blocked = false;
    tr.changes.iterChanges((fromA, toA) => {
      if (blocked) return;
      for (let pos = fromA; pos < toA; pos++) {
        if (pos >= doc.length) continue;
        const line = doc.lineAt(pos);

        // Protect newlines at table boundaries
        if (pos === line.to) {
          if (findTableAtCursor(tables, line.from) ||
              (line.to + 1 <= doc.length && findTableAtCursor(tables, line.to + 1))) {
            blocked = true;
            return;
          }
          continue;
        }

        // Protect pipes and padding spaces
        if (isStructuralAt(state, pos, tables)) { blocked = true; return; }
      }
    });

    if (blocked) return [];
  }

  // Cursor clamping is handled by EditorView.atomicRanges — no
  // selection adjustment needed here.

  return tr;
});

// ---------------------------------------------------------------------------
// Table operations — structural mutations that bypass pipe protection
// ---------------------------------------------------------------------------

/** Dispatch a table mutation (add/delete row/col) with the bypass annotation. */
function dispatchTableMutation(
  view: EditorView,
  table: TableRange,
  mutate: (parsed: ParsedTable) => ParsedTable,
): void {
  const newTable = mutate(table.parsed);
  const newText = formatTable(newTable).join("\n");
  view.dispatch({
    changes: { from: table.from, to: table.to, insert: newText },
    annotations: tableOperationAnnotation.of(true),
  });
}

/** Delete the entire table from the document (including surrounding newlines). */
function dispatchDeleteTable(view: EditorView, table: TableRange): void {
  const range = getTableDeleteRange(view.state, table, table.from, table.to);
  if (!range) return;
  dispatchDeleteRange(view, range.from, range.to);
}

/** Delete a structural table range (whole table or selected body rows). */
function dispatchDeleteRange(view: EditorView, from: number, to: number): void {
  view.dispatch({
    changes: { from, to, insert: "" },
    annotations: tableOperationAnnotation.of(true),
  });
}

/**
 * Get the cursor's row index (0-based data row, -1 for header) and column
 * index within a table. Returns null if the cursor is not in the table.
 */
function getCursorPosition(
  view: EditorView,
  table: TableRange,
): { rowIndex: number | null; colIndex: number | null } {
  const rowIndex = getCursorRowIndex(view, table);
  const colIndex = getCursorColIndex(view, table);
  return { rowIndex, colIndex };
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function buildGridContextMenuItems(
  view: EditorView,
  table: TableRange,
): ContextMenuItem[] {
  const { rowIndex, colIndex } = getCursorPosition(view, table);

  return [
    {
      label: "Insert Row Above",
      disabled: rowIndex === null,
      action: () => {
        dispatchTableMutation(view, table, (parsed) =>
          addRow(parsed, rowIndex ?? 0),
        );
      },
    },
    {
      label: "Insert Row Below",
      action: () => {
        dispatchTableMutation(view, table, (parsed) =>
          addRow(parsed, rowIndex !== null ? rowIndex + 1 : undefined),
        );
      },
    },
    {
      label: "Insert Column Left",
      action: () => {
        dispatchTableMutation(view, table, (parsed) =>
          addColumn(parsed, colIndex ?? 0),
        );
      },
    },
    {
      label: "Insert Column Right",
      action: () => {
        dispatchTableMutation(view, table, (parsed) =>
          addColumn(parsed, colIndex !== null ? colIndex + 1 : undefined),
        );
      },
    },
    { label: "-" },
    {
      label: "Delete Row",
      disabled: rowIndex === null || table.parsed.rows.length === 0,
      action: () => {
        if (rowIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => deleteRow(parsed, rowIndex));
      },
    },
    {
      label: "Delete Column",
      disabled: colIndex === null || table.parsed.header.cells.length <= 1,
      action: () => {
        if (colIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => deleteColumn(parsed, colIndex));
      },
    },
    { label: "-" },
    {
      label: "Align Left",
      disabled: colIndex === null,
      action: () => {
        if (colIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => setAlignment(parsed, colIndex, "left"));
      },
    },
    {
      label: "Align Center",
      disabled: colIndex === null,
      action: () => {
        if (colIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => setAlignment(parsed, colIndex, "center"));
      },
    },
    {
      label: "Align Right",
      disabled: colIndex === null,
      action: () => {
        if (colIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => setAlignment(parsed, colIndex, "right"));
      },
    },
    { label: "-" },
    {
      label: "Move Row Up",
      disabled: rowIndex === null || rowIndex <= 0,
      action: () => {
        if (rowIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => moveRow(parsed, rowIndex, rowIndex - 1));
      },
    },
    {
      label: "Move Row Down",
      disabled: rowIndex === null || rowIndex >= table.parsed.rows.length - 1,
      action: () => {
        if (rowIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => moveRow(parsed, rowIndex, rowIndex + 1));
      },
    },
    {
      label: "Move Column Left",
      disabled: colIndex === null || colIndex <= 0,
      action: () => {
        if (colIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => moveColumn(parsed, colIndex, colIndex - 1));
      },
    },
    {
      label: "Move Column Right",
      disabled: colIndex === null || colIndex >= table.parsed.header.cells.length - 1,
      action: () => {
        if (colIndex === null) return;
        dispatchTableMutation(view, table, (parsed) => moveColumn(parsed, colIndex, colIndex + 1));
      },
    },
    { label: "-" },
    {
      label: "Delete Table",
      action: () => dispatchDeleteTable(view, table),
    },
  ];
}

const gridContextMenuHandler = EditorView.domEventHandlers({
  contextmenu(event: MouseEvent, view: EditorView) {
    const tables = findTablesInState(view.state);
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const table = findTableAtCursor(tables, pos);
    if (!table) return false;

    event.preventDefault();
    // Move cursor to the right-clicked position so getCursorPosition works
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    new ContextMenu(buildGridContextMenuItems(view, table), event.clientX, event.clientY);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Full-table selection + delete
// ---------------------------------------------------------------------------

/**
 * Compute the structural delete range for a selection inside a table.
 *
 * Supports two cases:
 * - full-table selection: delete the entire table
 * - full body-row selection: delete one or more data rows
 */
export function getTableDeleteRange(
  state: EditorState,
  table: TableRange,
  from: number,
  to: number,
): { from: number; to: number; kind: "table" | "rows" } | null {
  if (from === to) return null;
  const doc = state.doc;
  const tableLastLine = doc.line(table.startLineNumber + table.lines.length - 1);
  const tableContentTo = tableLastLine.to;

  if (from <= table.from && to >= tableContentTo) {
    let deleteTo = table.to;
    if (deleteTo < doc.length && doc.sliceString(deleteTo, deleteTo + 1) === "\n") {
      deleteTo += 1;
    }
    let deleteFrom = table.from;
    if (deleteFrom > 0 && doc.sliceString(deleteFrom - 1, deleteFrom) === "\n") {
      deleteFrom -= 1;
    }
    return { from: deleteFrom, to: deleteTo, kind: "table" };
  }

  if (table.parsed.rows.length === 0) return null;

  const firstBodyLine = doc.line(table.startLineNumber + 2);
  const lastBodyLine = doc.line(table.startLineNumber + 1 + table.parsed.rows.length);
  const lastBodyTo = lastBodyLine.to < doc.length ? lastBodyLine.to + 1 : lastBodyLine.to;

  // Header and separator remain protected unless the whole table is selected.
  if (from < firstBodyLine.from || to > lastBodyTo) return null;

  let deleteFrom: number | null = null;
  let deleteTo: number | null = null;

  for (let rowIndex = 0; rowIndex < table.parsed.rows.length; rowIndex += 1) {
    const line = doc.line(table.startLineNumber + 2 + rowIndex);
    const lineDeleteTo = line.to < doc.length ? line.to + 1 : line.to;
    const coversWholeRow = from <= line.from && to >= line.to;
    const overlapsRow = to > line.from && from < lineDeleteTo;

    if (coversWholeRow) {
      if (deleteFrom === null) deleteFrom = line.from;
      deleteTo = lineDeleteTo;
      continue;
    }

    // Partial-row structural deletes are invalid.
    if (overlapsRow) return null;
  }

  if (deleteFrom === null || deleteTo === null) return null;
  return { from: deleteFrom, to: deleteTo, kind: "rows" };
}

/**
 * Backspace/Delete handler for structural table selection deletes.
 *
 * Deletes a full table when the whole table is selected, or deletes the
 * selected body rows when one or more complete data rows are selected.
 */
export function deleteSelectedTableSelection(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;

  const tables = findTablesInState(view.state);
  for (const table of tables) {
    const range = getTableDeleteRange(view.state, table, from, to);
    if (!range) continue;
    dispatchDeleteRange(view, range.from, range.to);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Plugin and theme
// ---------------------------------------------------------------------------

/** Structural decorations: pipe replacements, line classes, separator hiding.
 *  Also provides atomicRanges so CM6 cursor motion skips structural zones. */
const tableGridPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    outerDecorations: DecorationSet;
    atomicRanges: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const artifacts = buildTableGridArtifacts(view.state);
      this.decorations = artifacts.structuralDecorations;
      this.outerDecorations = artifacts.cellDecorations;
      this.atomicRanges = artifacts.atomicRanges;
    }
    update(update: ViewUpdate) {
      if (update.docChanged || tableDiscoveryChanged(update)) {
        const artifacts = buildTableGridArtifacts(update.state);
        this.decorations = artifacts.structuralDecorations;
        this.outerDecorations = artifacts.cellDecorations;
        this.atomicRanges = artifacts.atomicRanges;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      [
        EditorView.outerDecorations.of((view) =>
          view.plugin(plugin)?.outerDecorations ?? Decoration.none,
        ),
        EditorView.atomicRanges.of((view) =>
          view.plugin(plugin)?.atomicRanges ?? Decoration.none,
        ),
      ],
  },
);

const tableGridTheme = EditorView.baseTheme({
  ".cf-grid-pipe": { display: "none" },
  ".cf-grid-row .cm-widgetBuffer": { display: "none" },

  /* Search highlights: cell marks use outerDecorations so they wrap around
   * search marks. No special handling needed — the standard CM6 search
   * highlight classes render inside the grid cells correctly. */

  ".cf-grid-row": {
    gap: "0",
    borderLeft: "1px solid var(--cf-border, #ddd)",
    borderRight: "1px solid var(--cf-border, #ddd)",
    borderTop: "1px solid var(--cf-border, #ddd)",
    padding: "0 !important",
    gridTemplateRows: "auto",
    gridAutoRows: "0",
  },
  ".cf-grid-row-last": { borderBottom: "1px solid var(--cf-border, #ddd)" },
  ".cf-grid-header": {
    fontWeight: "700",
    backgroundColor: "var(--cf-bg-secondary, #f5f5f5)",
    borderBottom: "2px solid var(--cf-border, #ccc)",
  },
  ".cf-grid-cell": {
    padding: "4px 0",
    borderRight: "1px solid var(--cf-border, #ddd)",
    minHeight: "1.5em",
    overflow: "hidden",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    minWidth: "0",
  },
  ".cf-grid-cell:last-child": { borderRight: "none" },
  ".cf-grid-cell-header": { fontWeight: "700" },
  ".cf-grid-separator": {
    display: "none !important",
    height: "0 !important",
    overflow: "hidden !important",
    padding: "0 !important",
    margin: "0 !important",
    border: "none !important",
  },
});

// ---------------------------------------------------------------------------
// Bundled extension
// ---------------------------------------------------------------------------

export const tableGridExtension = [
  tableDiscoveryField,
  tableGridPlugin,
  tableGridTheme,
  tableClipboardHandlers,
  gridContextMenuHandler,
  keymap.of(tableKeyBindings),
  pipeProtectionFilter,
];
