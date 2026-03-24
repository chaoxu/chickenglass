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
 * - Cursor is clamped to editable content zones
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
import { EditorSelection, EditorState, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  findTablesInState,
  findTableAtCursor,
  findPipePositions,
  type TableRange,
} from "./table-discovery";
import { createSimpleTextWidget } from "./render-core";

// ---------------------------------------------------------------------------
// Decorations (module-level singletons)
// ---------------------------------------------------------------------------

const pipeReplace = Decoration.replace({
  widget: createSimpleTextWidget("span", "cf-grid-pipe", ""),
});
const cellMark = Decoration.mark({ class: "cf-grid-cell", inclusive: true });
const headerCellMark = Decoration.mark({ class: "cf-grid-cell cf-grid-cell-header", inclusive: true });
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

/** Clamp pos to nearest editable zone. Uses pre-computed tables. */
function clampToEditable(
  state: EditorState,
  pos: number,
  tables: readonly TableRange[],
): number | null {
  if (!findTableAtCursor(tables, pos)) return null;
  const line = state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  if (pipes.length < 2) return null;
  const result = findCellAtPos(pos, line, pipes);
  if (!result) return null;
  if (pos >= result.cell.from && pos <= result.cell.to) return null;
  return pos < result.cell.from ? result.cell.from : result.cell.to;
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

function buildTableGridDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== "Table") return;

      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      const columns = findPipePositions(startLine.text).length - 1;
      if (columns < 1) return;

      for (let ln = startLine.number; ln <= endLine.number; ln++) {
        const line = doc.line(ln);

        if (ln === startLine.number + 1) {
          builder.add(line.from, line.from, separatorLine);
          continue;
        }

        builder.add(line.from, line.from, gridRowLine(
          columns, ln === startLine.number, ln === endLine.number,
        ));

        const pipes = findPipePositions(line.text);
        if (pipes.length < 2) continue;
        const mark = ln === startLine.number ? headerCellMark : cellMark;

        for (let pi = 0; pi < pipes.length; pi++) {
          const pipeDocPos = line.from + pipes[pi];
          builder.add(pipeDocPos, pipeDocPos + 1, pipeReplace);
          if (pi < pipes.length - 1) {
            const cellStart = pipeDocPos + 1;
            const cellEnd = line.from + pipes[pi + 1];
            if (cellEnd > cellStart) builder.add(cellStart, cellEnd, mark);
          }
        }
      }

      return false;
    },
  });

  return builder.finish();
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

function moveHorizontal(view: EditorView, direction: 1 | -1): boolean {
  const pos = view.state.selection.main.head;
  const tables = findTablesInState(view.state);
  if (!findTableAtCursor(tables, pos)) return false;

  const line = view.state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  const result = findCellAtPos(pos, line, pipes);
  if (!result) return false;
  const { cell, cells } = result;

  const atBoundary = direction === 1 ? pos >= cell.to : pos <= cell.from;
  if (!atBoundary) return false;

  // Try adjacent cell on same row
  const adjacent = cells.find(c => c.col === cell.col + direction);
  if (adjacent) {
    view.dispatch({ selection: { anchor: direction === 1 ? adjacent.from : adjacent.to } });
    return true;
  }

  // Try first/last cell on adjacent row
  const targetLine = adjacentTableLine(view.state.doc, line.number, direction);
  if (targetLine && findTableAtCursor(tables, targetLine.from)) {
    const targetPipes = findPipePositions(targetLine.text);
    const targetCells = getCellBounds(targetLine, targetPipes);
    if (targetCells.length > 0) {
      const tc = direction === 1 ? targetCells[0] : targetCells[targetCells.length - 1];
      view.dispatch({ selection: { anchor: direction === 1 ? tc.from : tc.to } });
      return true;
    }
  }

  return true; // block moving past table boundary
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
  { key: "ArrowRight", run: (view) => moveHorizontal(view, 1) },
  { key: "ArrowLeft", run: (view) => moveHorizontal(view, -1) },
];

// ---------------------------------------------------------------------------
// Structure protection
// ---------------------------------------------------------------------------

const pipeProtectionFilter = EditorState.transactionFilter.of((tr) => {
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

  if (tr.selection) {
    const state = tr.state;
    const tables = findTablesInState(state);
    if (tables.length === 0) return tr;

    let needsAdjust = false;
    const newRanges = tr.selection.ranges.map((range) => {
      const clamped = clampToEditable(state, range.head, tables);
      if (clamped !== null) { needsAdjust = true; return EditorSelection.cursor(clamped); }
      return range;
    });

    if (needsAdjust) {
      return { ...tr, selection: EditorSelection.create(newRanges, tr.selection.mainIndex) };
    }
  }

  return tr;
});

// ---------------------------------------------------------------------------
// Plugin and theme
// ---------------------------------------------------------------------------

const tableGridPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildTableGridDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
        this.decorations = buildTableGridDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const tableGridTheme = EditorView.baseTheme({
  ".cf-grid-pipe": { display: "none" },
  ".cf-grid-row .cm-widgetBuffer": { display: "none" },

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
  tableGridPlugin,
  tableGridTheme,
  tableClipboardHandlers,
  keymap.of(tableKeyBindings),
  pipeProtectionFilter,
];
