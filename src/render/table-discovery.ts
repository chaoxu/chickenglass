import {
  forceParsing,
  syntaxParserRunning,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { findTablePipePositions } from "../lib/table-inline-span";
import { findTablesInState, type TableRange } from "../state/table-discovery";

export { findTablesInState, type TableRange } from "../state/table-discovery";

class TableDiscoveryParsePlugin {
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(_update: ViewUpdate): void {
    if (this.destroyed) return;
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    const scheduled = this.scheduled;
    this.scheduled = null;
    if (scheduled !== null) clearTimeout(scheduled);
  }

  private schedule(): void {
    if (this.destroyed) return;
    if (this.scheduled !== null) return;
    if (syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) return;

    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      if (this.destroyed) return;
      if (syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) return;
      forceParsing(this.view, this.view.state.doc.length, 25);
      if (
        !this.destroyed &&
        !syntaxTreeAvailable(this.view.state, this.view.state.doc.length) &&
        syntaxParserRunning(this.view)
      ) {
        this.schedule();
      }
    }, 0);
  }
}

export const tableDiscoveryParsePlugin = ViewPlugin.fromClass(TableDiscoveryParsePlugin);

/**
 * Find the positions of column-separator pipe characters in a table line.
 *
 * Implements Pandoc's inline-span-aware approach: before treating `|` as a
 * column delimiter, the scanner tries to consume recognised inline spans at
 * the current position. Pipes inside those spans are invisible to the
 * column splitter. Spans handled:
 *   - `\|`      — escaped pipe (and `\X` for any X)
 *   - `\(...\)` — backslash-paren inline math (with `\|` for literal pipes)
 *   - `$...$`   — single-dollar inline math
 *   - `` `...` `` / ` `` `` ``...`` `` `` ` — backtick code spans (any run length)
 *
 * Lezer's block-level table parser splits rows on all `|` characters before
 * inline parsing runs, so no amount of Lezer tree-walking can detect pipes
 * inside math or code that span apparent cell boundaries. A text-scanning
 * approach is the only option, and is exactly what Pandoc's `pipeTableRow`
 * does with its `chunk` combinator.
 */
export function findPipePositions(text: string): number[] {
  return findTablePipePositions(text);
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
