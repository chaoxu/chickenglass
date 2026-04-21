export interface CellBounds {
  readonly from: number;
  readonly to: number;
  readonly col: number;
}

export interface TableLine {
  readonly from: number;
  readonly text: string;
}

export interface NumberedTableLine extends TableLine {
  readonly number: number;
  readonly to: number;
}

export interface TableDocument {
  readonly lines: number;
  line(n: number): NumberedTableLine;
}

const SEPARATOR_RE = /^\s*\|[\s:-]+\|/;

export function isSeparatorRow(text: string): boolean {
  return SEPARATOR_RE.test(text);
}

/** Compute editable bounds for all cells on a table line. */
export function getCellBounds(line: TableLine, pipes: readonly number[]): CellBounds[] {
  const cells: CellBounds[] = [];
  for (let i = 0; i < pipes.length - 1; i++) {
    const rawStart = pipes[i] + 1;
    const rawEnd = pipes[i + 1];
    let start = rawStart;
    while (start < rawEnd && line.text[start] === " ") start++;
    let end = rawEnd;
    while (end > start && line.text[end - 1] === " ") end--;
    if (start >= rawEnd) {
      start = rawStart + 1;
      end = start;
    }
    cells.push({ from: line.from + start, to: line.from + end, col: i });
  }
  return cells;
}

/** Find which cell a document position falls in. Returns the cell and full cells array. */
export function findCellAtPos(
  pos: number,
  line: TableLine,
  pipes: readonly number[],
): { cell: CellBounds; cells: readonly CellBounds[] } | null {
  const cells = getCellBounds(line, pipes);
  const posInLine = pos - line.from;
  for (const cell of cells) {
    const rawStart = pipes[cell.col] + 1;
    const rawEnd = pipes[cell.col + 1];
    if (posInLine >= rawStart && posInLine <= rawEnd) return { cell, cells };
  }
  return null;
}

export function adjacentTableLine(
  doc: TableDocument,
  lineNum: number,
  direction: 1 | -1,
): NumberedTableLine | null {
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
