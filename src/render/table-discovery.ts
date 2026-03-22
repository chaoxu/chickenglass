import type { EditorState, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
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

/** Find the positions of all unescaped pipe characters in a string. */
export function findPipePositions(text: string): number[] {
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

/** Find all Table nodes in the visible ranges and parse them. */
export function findTablesInView(view: EditorView): TableRange[] {
  const tables: TableRange[] = [];
  const seen = new Set<number>();

  for (const { from: vFrom, to: vTo } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: vFrom,
      to: vTo,
      enter(node) {
        if (node.name !== "Table" || seen.has(node.from)) return;
        seen.add(node.from);
        const table = createTableRange(view.state.doc, node.from, node.to);
        if (table) tables.push(table);
      },
    });
  }

  return tables;
}

/**
 * Find all tables using the syntax tree from EditorState.
 * Unlike the view-based helper, this does not filter by visible ranges
 * since StateFields operate on the full document.
 */
export function findTablesInState(state: EditorState): TableRange[] {
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

/** Find the table containing the given cursor position, or null. */
export function findTableAtCursor(
  tables: readonly TableRange[],
  cursorPos: number,
): TableRange | null {
  for (const table of tables) {
    if (cursorPos >= table.from && cursorPos <= table.to) return table;
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
    const dist = Math.abs(parseInt(element.dataset.tableFrom ?? "0", 10) - trackedFrom);
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
