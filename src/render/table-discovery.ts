import { StateField, type EditorState, type Text } from "@codemirror/state";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { parseTable, type ParsedTable } from "./table-utils";

/** A table found in the document with its source range. */
export interface TableRange {
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

function createTableRange(
  doc: Text,
  tableFrom: number,
  tableTo: number,
): TableRange | null {
  const startLine = doc.lineAt(tableFrom);
  const endLine = doc.lineAt(tableTo);
  const lines: string[] = [];
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    lines.push(doc.line(ln).text);
  }

  const parsed = parseTable(lines);
  if (!parsed) return null;

  const sepLine = doc.line(startLine.number + 1);
  const separatorFrom = sepLine.from;
  const separatorTo = sepLine.to < doc.length ? sepLine.to + 1 : sepLine.to;

  return {
    from: tableFrom,
    to: tableTo,
    separatorFrom,
    separatorTo,
    parsed,
    lines,
    startLineNumber: startLine.number,
  };
}

function collectTables(state: EditorState): readonly TableRange[] {
  const tables: TableRange[] = [];
  const seen = new Set<number>();

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table" || seen.has(node.from)) return;
      seen.add(node.from);
      const table = createTableRange(state.doc, node.from, node.to);
      if (table) tables.push(table);
    },
  });

  return tables;
}

/**
 * Shared table discovery cache for the current document/tree.
 *
 * Table consumers should read this field instead of rewalking the syntax tree
 * on selection, focus, viewport, or handler-only updates.
 */
export const tableDiscoveryField = StateField.define<readonly TableRange[]>({
  create(state) {
    return collectTables(state);
  },

  update(value, tr) {
    if (tr.docChanged) {
      return collectTables(tr.state);
    }
    if (
      syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
      syntaxTreeAvailable(tr.state, tr.state.doc.length)
    ) {
      return collectTables(tr.state);
    }
    return value;
  },

  compare(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const ta = a[i];
      const tb = b[i];
      if (ta.from !== tb.from || ta.to !== tb.to) return false;
      if (ta.lines.length !== tb.lines.length) return false;
      for (let j = 0; j < ta.lines.length; j++) {
        if (ta.lines[j] !== tb.lines[j]) return false;
      }
    }
    return true;
  },
});

/** Find the positions of all unescaped pipe characters in a string. */
export function findPipePositions(text: string): number[] {
  const pipes: number[] = [];
  let isEscaped = false;
  let inMath = false;
  for (let i = 0; i < text.length; i++) {
    if (isEscaped) {
      isEscaped = false;
    } else if (text[i] === "\\") {
      isEscaped = true;
    } else if (text[i] === "$") {
      inMath = !inMath;
    } else if (text[i] === "|" && !inMath) {
      pipes.push(i);
    }
  }
  return pipes;
}

/**
 * Find all Table nodes in the visible ranges and parse them.
 *
 * NOTE: collectNodeRangesExcludingCursor() does not apply here.
 * This function collects TableRange data objects (not Decoration ranges) and
 * has no cursor-exclusion logic — tables are collected regardless of cursor
 * position. The caller (table-render.ts) applies cursor logic separately when
 * deciding how to render each table.
 */
export function findTablesInView(view: EditorView): readonly TableRange[] {
  const tables = findTablesInState(view.state);
  return tables.filter((table) =>
    view.visibleRanges.some(({ from, to }) => table.from <= to && table.to >= from),
  );
}

/**
 * Find all tables using the syntax tree from EditorState.
 * Unlike the view-based helper, this does not filter by visible ranges
 * since StateFields operate on the full document.
 */
export function findTablesInState(state: EditorState): readonly TableRange[] {
  return state.field(tableDiscoveryField, false) ?? collectTables(state);
}

/** Find the table containing the given cursor position, or null. */
export function findTableAtCursor(
  tables: readonly TableRange[],
  cursorPos: number,
): TableRange | null {
  let low = 0;
  let high = tables.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const table = tables[mid];
    if (cursorPos < table.from) {
      high = mid - 1;
      continue;
    }
    if (cursorPos > table.to) {
      low = mid + 1;
      continue;
    }
    return table;
  }
  return null;
}

/**
 * Find the table whose `from` position is closest to the given position.
 *
 * Used when a widget tracks its table position across edits — cumulative
 * shifts from cell edits can drift the position arbitrarily far, so a
 * fixed tolerance is unreliable. Returns the nearest table by absolute
 * distance from the tracked position.
 */
export function findClosestTable(
  tables: readonly TableRange[],
  trackedFrom: number,
): TableRange | undefined {
  let best: TableRange | undefined;
  let bestDist = Infinity;
  for (const table of tables) {
    const dist = Math.abs(table.from - trackedFrom);
    if (dist < bestDist) {
      bestDist = dist;
      best = table;
    }
  }
  return best;
}

/**
 * Find the closest `.cf-table-widget` DOM container to the given
 * tracked position. Used after add-row mutations to locate the
 * rebuilt widget in the DOM for focus scheduling.
 */
export function findClosestWidgetContainer(
  view: EditorView,
  trackedFrom: number,
): HTMLElement | null {
  const containers = view.dom.querySelectorAll(".cf-table-widget");
  let closest: HTMLElement | null = null;
  let closestDist = Infinity;
  for (const container of containers) {
    const element = container as HTMLElement;
    const parsed = parseInt(element.dataset.tableFrom ?? "0", 10);
    const tableFrom = Number.isFinite(parsed) ? parsed : 0;
    const dist = Math.abs(tableFrom - trackedFrom);
    if (dist < closestDist) {
      closestDist = dist;
      closest = element;
    }
  }
  return closest;
}

/** Get the 0-based data row index the cursor is on, or null. */
export function getCursorRowIndex(
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
export function getCursorColIndex(
  view: EditorView,
  table: TableRange,
): number | null {
  const cursorPos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursorPos);
  const cursorCol = cursorPos - line.from;

  const pipes = findPipePositions(line.text.slice(0, cursorCol));
  let col = pipes.length - 1;
  if (col < 0) col = 0;
  if (col >= table.parsed.header.cells.length) {
    col = table.parsed.header.cells.length - 1;
  }
  return col;
}

/** Find the cell boundaries for a given position in a table line. */
export function findCellBounds(
  lineText: string,
  lineFrom: number,
  colIndex: number,
): { from: number; to: number } | null {
  const pipes = findPipePositions(lineText);

  if (pipes.length < 2) return null;
  if (colIndex >= pipes.length - 1) return null;

  const cellStart = pipes[colIndex] + 1;
  const cellEnd = pipes[colIndex + 1];

  let contentStart = cellStart;
  while (contentStart < cellEnd && lineText[contentStart] === " ") contentStart++;
  let contentEnd = cellEnd;
  while (contentEnd > contentStart && lineText[contentEnd - 1] === " ") contentEnd--;

  return { from: lineFrom + contentStart, to: lineFrom + contentEnd };
}

/** Skip the separator row index (line index 1 in the table). */
export function skipSeparator(lineIdx: number, direction: 1 | -1): number {
  return lineIdx === 1 ? lineIdx + direction : lineIdx;
}
