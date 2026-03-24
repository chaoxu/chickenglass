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
  WidgetType,
  keymap,
} from "@codemirror/view";
import { EditorSelection, EditorState, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { findTablesInState, findTableAtCursor } from "./table-discovery";

// ---------------------------------------------------------------------------
// Widgets and marks
// ---------------------------------------------------------------------------

class PipeWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cf-grid-pipe";
    return span;
  }
  eq(): boolean { return true; }
  ignoreEvent(): boolean { return false; }
}

const pipeReplace = Decoration.replace({ widget: new PipeWidget() });
const cellMark = Decoration.mark({ class: "cf-grid-cell", inclusive: true });
const headerCellMark = Decoration.mark({ class: "cf-grid-cell cf-grid-cell-header", inclusive: true });

function gridRowLine(columns: number, isHeader: boolean, isLast: boolean = false): Decoration {
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

const separatorLine = Decoration.line({ class: "cf-grid-separator" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPipePositions(text: string): number[] {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|" && (i === 0 || text[i - 1] !== "\\")) {
      positions.push(i);
    }
  }
  return positions;
}

/** Editable bounds of a single cell (document positions). */
interface CellBounds {
  /** Start of editable content (after pipe + padding spaces). */
  from: number;
  /** End of editable content (before padding spaces + next pipe). */
  to: number;
  /** Column index (0-based). */
  col: number;
}

/** Compute the editable bounds for all cells on a table line. */
function getCellBounds(line: { from: number; text: string }, pipes: number[]): CellBounds[] {
  const cells: CellBounds[] = [];
  for (let i = 0; i < pipes.length - 1; i++) {
    const rawStart = pipes[i] + 1;
    const rawEnd = pipes[i + 1];
    // Trim leading spaces
    let start = rawStart;
    while (start < rawEnd && line.text[start] === " ") start++;
    // Trim trailing spaces
    let end = rawEnd;
    while (end > start && line.text[end - 1] === " ") end--;
    // If entirely spaces, allow cursor in the middle (empty cell)
    if (start >= rawEnd) {
      start = rawStart + 1;
      end = start;
    }
    cells.push({ from: line.from + start, to: line.from + end, col: i });
  }
  return cells;
}

/** Find which cell the cursor (document position) is in. */
function findCellAtPos(pos: number, line: { from: number; text: string }, pipes: number[]): CellBounds | null {
  const cells = getCellBounds(line, pipes);
  const posInLine = pos - line.from;
  for (const cell of cells) {
    // Cursor is in this cell's raw zone (between its pipes)
    const rawStart = pipes[cell.col] + 1;
    const rawEnd = pipes[cell.col + 1];
    if (posInLine >= rawStart && posInLine <= rawEnd) return cell;
  }
  return null;
}

/** Check if cursor position is inside a table. */
function cursorInTable(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  const pos = view.state.selection.main.head;
  return findTableAtCursor(tables, pos) !== null;
}

/**
 * Check if a document position is in a "structural zone" (pipe or padding space).
 * Returns the nearest editable position if structural, or null if already editable.
 */
function clampToEditable(state: EditorState, pos: number): number | null {
  const tables = findTablesInState(state);
  if (!findTableAtCursor(tables, pos)) return null;

  const line = state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  if (pipes.length < 2) return null;

  const cell = findCellAtPos(pos, line, pipes);
  if (!cell) return null;

  // Already in editable zone
  if (pos >= cell.from && pos <= cell.to) return null;

  // In structural zone — clamp to nearest editable bound
  if (pos < cell.from) return cell.from;
  return cell.to;
}

/** Check if a line is a separator row. */
function isSeparatorRow(text: string): boolean {
  return /^\s*\|[\s:-]+\|/.test(text);
}

/** Find the next/previous table line (skipping separator). */
function adjacentTableLine(view: EditorView, lineNum: number, direction: 1 | -1): ReturnType<typeof view.state.doc.line> | null {
  const target = lineNum + direction;
  if (target < 1 || target > view.state.doc.lines) return null;
  const line = view.state.doc.line(target);
  if (isSeparatorRow(line.text)) {
    const skip = target + direction;
    if (skip < 1 || skip > view.state.doc.lines) return null;
    return view.state.doc.line(skip);
  }
  return line;
}

/** Find the next cell position (for Tab navigation). */
function findNextCell(view: EditorView, forward: boolean): number | null {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  const cells = getCellBounds(line, pipes);
  const cell = findCellAtPos(pos, line, pipes);
  if (!cell) return null;

  if (forward) {
    // Next cell on same row?
    const nextCell = cells.find(c => c.col === cell.col + 1);
    if (nextCell) return nextCell.from;
    // First cell on next row
    const nextLine = adjacentTableLine(view, line.number, 1);
    if (nextLine) {
      const nextPipes = findPipePositions(nextLine.text);
      const nextCells = getCellBounds(nextLine, nextPipes);
      if (nextCells.length > 0) return nextCells[0].from;
    }
  } else {
    // Previous cell on same row?
    const prevCell = cells.find(c => c.col === cell.col - 1);
    if (prevCell) return prevCell.from;
    // Last cell on previous row
    const prevLine = adjacentTableLine(view, line.number, -1);
    if (prevLine) {
      const prevPipes = findPipePositions(prevLine.text);
      const prevCells = getCellBounds(prevLine, prevPipes);
      if (prevCells.length > 0) return prevCells[prevCells.length - 1].from;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

function buildTableGridDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      if (node.name !== "Table") return;

      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      const headerPipes = findPipePositions(startLine.text);
      const columns = headerPipes.length - 1;
      if (columns < 1) return;

      for (let ln = startLine.number; ln <= endLine.number; ln++) {
        const line = doc.line(ln);
        const isHeader = ln === startLine.number;
        const isSeparator = ln === startLine.number + 1;
        const isLastRow = ln === endLine.number;

        if (isSeparator) {
          builder.add(line.from, line.from, separatorLine);
          continue;
        }

        builder.add(line.from, line.from, gridRowLine(columns, isHeader, isLastRow));

        const pipes = findPipePositions(line.text);
        if (pipes.length < 2) continue;

        const mark = isHeader ? headerCellMark : cellMark;

        for (let pi = 0; pi < pipes.length; pi++) {
          const pipeDocPos = line.from + pipes[pi];
          builder.add(pipeDocPos, pipeDocPos + 1, pipeReplace);

          if (pi < pipes.length - 1) {
            const cellStart = pipeDocPos + 1;
            const cellEnd = line.from + pipes[pi + 1];
            if (cellEnd > cellStart) {
              builder.add(cellStart, cellEnd, mark);
            }
          }
        }
      }

      return false;
    },
  });

  return builder.finish();
}

// ---------------------------------------------------------------------------
// Clipboard handlers
// ---------------------------------------------------------------------------

/** Strip pipe characters from copied text when selection is in a table. */
function handleCopy(event: ClipboardEvent, view: EditorView): boolean {
  if (!cursorInTable(view)) return false;

  const { from, to } = view.state.selection.main;
  if (from === to) return false; // no selection

  let text = view.state.sliceDoc(from, to);
  // Remove pipe characters (but not escaped ones)
  text = text.replace(/(?<!\\)\|/g, "");
  // Clean up extra whitespace from removed pipes
  text = text.replace(/  +/g, " ").trim();

  event.clipboardData?.setData("text/plain", text);
  event.preventDefault();
  return true;
}

/** Paste into table: flatten to single line, strip block syntax, prevent pipes. */
function handlePaste(event: ClipboardEvent, view: EditorView): boolean {
  if (!cursorInTable(view)) return false;

  const raw = event.clipboardData?.getData("text/plain");
  if (!raw) return false;

  // Flatten to single line
  let text = raw.replace(/\n/g, " ").replace(/\r/g, "");
  // Strip pipe characters (would break table structure)
  text = text.replace(/\|/g, "");
  // Strip block-level markdown syntax
  text = text.replace(/^#{1,6}\s+/g, ""); // headings
  text = text.replace(/^>{1,}\s*/g, "");   // blockquotes
  text = text.replace(/^[-*+]\s+/g, "");   // list markers
  text = text.replace(/^\d+\.\s+/g, "");   // ordered list
  text = text.replace(/^:::.*/g, "");       // fenced divs
  text = text.replace(/^```.*$/g, "");      // code fences
  // Clean up
  text = text.replace(/\s+/g, " ").trim();

  if (text) {
    view.dispatch(view.state.replaceSelection(text));
  }
  event.preventDefault();
  return true;
}

const tableClipboardHandlers = EditorView.domEventHandlers({
  copy(event, view) { return handleCopy(event, view); },
  cut(event, view) {
    if (handleCopy(event, view)) {
      // Delete the selection after copying
      view.dispatch(view.state.replaceSelection(""));
      return true;
    }
    return false;
  },
  paste(event, view) { return handlePaste(event, view); },
});

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

/** Move cursor to the same column in an adjacent row. */
function moveVertical(view: EditorView, direction: 1 | -1): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  const cell = findCellAtPos(pos, line, pipes);
  if (!cell) return false;

  const offsetInCell = Math.max(0, pos - cell.from);

  const targetLine = adjacentTableLine(view, line.number, direction);
  if (!targetLine) return false;

  const tables = findTablesInState(view.state);
  if (!findTableAtCursor(tables, targetLine.from)) return false;

  const targetPipes = findPipePositions(targetLine.text);
  const targetCells = getCellBounds(targetLine, targetPipes);
  const targetCell = targetCells.find(c => c.col === cell.col);
  if (!targetCell) return false;

  const cellWidth = targetCell.to - targetCell.from;
  const offset = Math.min(offsetInCell, cellWidth);
  view.dispatch({ selection: { anchor: targetCell.from + offset } });
  return true;
}

const tableKeyBindings: KeyBinding[] = [
  {
    key: "Enter",
    run(view) {
      return cursorInTable(view);
    },
  },
  {
    key: "Tab",
    run(view) {
      if (!cursorInTable(view)) return false;
      const next = findNextCell(view, true);
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
      if (!cursorInTable(view)) return false;
      const prev = findNextCell(view, false);
      if (prev !== null) {
        view.dispatch({ selection: { anchor: prev } });
        return true;
      }
      return false;
    },
  },
  {
    key: "ArrowUp",
    run(view) {
      return moveVertical(view, -1);
    },
  },
  {
    key: "ArrowDown",
    run(view) {
      return moveVertical(view, 1);
    },
  },
  {
    key: "ArrowRight",
    run(view) {
      if (!cursorInTable(view)) return false;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      const pipes = findPipePositions(line.text);
      const cell = findCellAtPos(pos, line, pipes);
      if (!cell) return false;
      // At end of editable zone — jump to next cell
      if (pos >= cell.to) {
        const cells = getCellBounds(line, pipes);
        const nextCell = cells.find(c => c.col === cell.col + 1);
        if (nextCell) {
          view.dispatch({ selection: { anchor: nextCell.from } });
          return true;
        }
        // Jump to first cell of next row
        const nextLine = adjacentTableLine(view, line.number, 1);
        if (nextLine) {
          const nextPipes = findPipePositions(nextLine.text);
          const nextCells = getCellBounds(nextLine, nextPipes);
          if (nextCells.length > 0) {
            view.dispatch({ selection: { anchor: nextCells[0].from } });
            return true;
          }
        }
        return true; // block moving past table end
      }
      return false; // let CM6 handle normal right movement
    },
  },
  {
    key: "ArrowLeft",
    run(view) {
      if (!cursorInTable(view)) return false;
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      const pipes = findPipePositions(line.text);
      const cell = findCellAtPos(pos, line, pipes);
      if (!cell) return false;
      // At start of editable zone — jump to previous cell
      if (pos <= cell.from) {
        const cells = getCellBounds(line, pipes);
        const prevCell = cells.find(c => c.col === cell.col - 1);
        if (prevCell) {
          view.dispatch({ selection: { anchor: prevCell.to } });
          return true;
        }
        // Jump to last cell of previous row
        const prevLine = adjacentTableLine(view, line.number, -1);
        if (prevLine) {
          const prevPipes = findPipePositions(prevLine.text);
          const prevCells = getCellBounds(prevLine, prevPipes);
          if (prevCells.length > 0) {
            view.dispatch({ selection: { anchor: prevCells[prevCells.length - 1].to } });
            return true;
          }
        }
        return true; // block moving past table start
      }
      return false; // let CM6 handle normal left movement
    },
  },
];

// ---------------------------------------------------------------------------
// Pipe protection — prevent any edit that would delete/modify pipe characters
// ---------------------------------------------------------------------------

/**
 * Transaction filter that protects table structure.
 *
 * - Blocks changes that would delete/modify pipe characters
 * - Blocks changes that would merge table lines (delete newlines within tables)
 * - Blocks changes that would merge external text into a table row
 * - Clamps cursor positions so they never land on a pipe
 */
/**
 * Check if a document position is in a structural zone (pipe, padding space, or newline boundary).
 */
function isStructural(state: EditorState, pos: number): boolean {
  const tables = findTablesInState(state);
  if (!findTableAtCursor(tables, pos)) return false;
  const line = state.doc.lineAt(pos);
  const pipes = findPipePositions(line.text);
  if (pipes.length < 2) return false;
  const cell = findCellAtPos(pos, line, pipes);
  if (!cell) return true; // on a pipe itself
  return pos < cell.from || pos > cell.to;
}

const pipeProtectionFilter = EditorState.transactionFilter.of((tr) => {
  // --- Block changes that touch structural zones ---
  if (tr.docChanged) {
    const state = tr.startState;
    const doc = state.doc;
    const tables = findTablesInState(state);
    let blocked = false;

    tr.changes.iterChanges((fromA, toA) => {
      if (blocked) return;
      for (let pos = fromA; pos < toA; pos++) {
        // Block newline deletion at table boundaries
        if (pos >= doc.length) continue;
        const line = doc.lineAt(pos);
        if (pos === line.to) {
          const inTable = findTableAtCursor(tables, line.from);
          const nextStart = line.to + 1;
          const nextInTable = nextStart <= doc.length ? findTableAtCursor(tables, nextStart) : null;
          if (inTable || nextInTable) { blocked = true; return; }
          continue;
        }

        // Block deletion of pipes and padding spaces
        if (isStructural(state, pos)) { blocked = true; return; }
      }
    });

    if (blocked) return [];
  }

  // --- Clamp cursor to editable zones ---
  if (tr.selection) {
    const state = tr.state;
    let needsAdjust = false;

    const newRanges = tr.selection.ranges.map((range) => {
      const clamped = clampToEditable(state, range.head);
      if (clamped !== null) {
        needsAdjust = true;
        return EditorSelection.cursor(clamped);
      }
      return range;
    });

    if (needsAdjust) {
      return { ...tr, selection: EditorSelection.create(newRanges, tr.selection.mainIndex) };
    }
  }

  return tr;
});

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const tableGridSpikePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildTableGridDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildTableGridDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const tableGridSpikeTheme = EditorView.baseTheme({
  ".cf-grid-pipe": {
    display: "none",
  },

  ".cf-grid-row .cm-widgetBuffer": {
    display: "none",
  },

  ".cf-grid-row": {
    gap: "0",
    borderLeft: "1px solid var(--cf-border, #ddd)",
    borderRight: "1px solid var(--cf-border, #ddd)",
    borderTop: "1px solid var(--cf-border, #ddd)",
    padding: "0 !important",
    gridTemplateRows: "auto",
    gridAutoRows: "0",
  },

  ".cf-grid-row-last": {
    borderBottom: "1px solid var(--cf-border, #ddd)",
  },

  ".cf-grid-header": {
    fontWeight: "700",
    backgroundColor: "var(--cf-bg-secondary, #f5f5f5)",
    borderBottom: "2px solid var(--cf-border, #ccc)",
  },

  ".cf-grid-cell": {
    padding: "4px 0", /* minimal vertical padding; horizontal comes from markdown spaces */
    borderRight: "1px solid var(--cf-border, #ddd)",
    minHeight: "1.5em",
    overflow: "hidden",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    minWidth: "0",
  },

  ".cf-grid-cell:last-child": {
    borderRight: "none",
  },

  ".cf-grid-cell-header": {
    fontWeight: "700",
  },

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
// Export: all table grid extensions bundled
// ---------------------------------------------------------------------------

export const tableGridExtension = [
  tableGridSpikePlugin,
  tableGridSpikeTheme,
  tableClipboardHandlers,
  keymap.of(tableKeyBindings),
  pipeProtectionFilter,
];
