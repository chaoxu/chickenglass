/**
 * Pure table-editing controller. Owns transition logic for table cell
 * mutations. Renderers call these functions and apply the result to their
 * local draft state.
 *
 * This separates "what changed" (pure) from "how to apply" (renderer).
 * TableDraft matches MarkdownTable's shape but is declared independently
 * so that src/state/ does not import from src/lexical/ internals.
 */

export interface TableDraft {
  readonly alignments: ReadonlyArray<"center" | "left" | "right" | null>;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export function updateTableHeaderCell(
  draft: TableDraft,
  columnIndex: number,
  nextValue: string,
): TableDraft {
  return {
    ...draft,
    headers: draft.headers.map((cell, i) => (i === columnIndex ? nextValue : cell)),
  };
}

export function updateTableBodyCell(
  draft: TableDraft,
  rowIndex: number,
  columnIndex: number,
  nextValue: string,
): TableDraft {
  return {
    ...draft,
    rows: draft.rows.map((row, ri) =>
      ri === rowIndex
        ? row.map((cell, ci) => (ci === columnIndex ? nextValue : cell))
        : row,
    ),
  };
}

export function addTableRow(draft: TableDraft): TableDraft {
  const emptyRow = draft.headers.map(() => "");
  return {
    ...draft,
    rows: [...draft.rows, emptyRow],
  };
}

export function removeTableRow(draft: TableDraft, rowIndex: number): TableDraft {
  if (rowIndex < 0 || rowIndex >= draft.rows.length) {
    return draft;
  }
  return {
    ...draft,
    rows: draft.rows.filter((_, i) => i !== rowIndex),
  };
}

export function addTableColumn(draft: TableDraft): TableDraft {
  return {
    alignments: [...draft.alignments, null],
    headers: [...draft.headers, ""],
    rows: draft.rows.map((row) => [...row, ""]),
  };
}

export function removeTableColumn(draft: TableDraft, columnIndex: number): TableDraft {
  if (columnIndex < 0 || columnIndex >= draft.headers.length) {
    return draft;
  }
  return {
    alignments: draft.alignments.filter((_, i) => i !== columnIndex),
    headers: draft.headers.filter((_, i) => i !== columnIndex),
    rows: draft.rows.map((row) => row.filter((_, i) => i !== columnIndex)),
  };
}

export function isTableDraftChanged(a: TableDraft, b: TableDraft): boolean {
  if (a === b) {
    return false;
  }
  if (a.headers.length !== b.headers.length || a.rows.length !== b.rows.length) {
    return true;
  }
  for (let i = 0; i < a.alignments.length; i++) {
    if (a.alignments[i] !== b.alignments[i]) {
      return true;
    }
  }
  for (let i = 0; i < a.headers.length; i++) {
    if (a.headers[i] !== b.headers[i]) {
      return true;
    }
  }
  for (let ri = 0; ri < a.rows.length; ri++) {
    const rowA = a.rows[ri];
    const rowB = b.rows[ri];
    if (rowA.length !== rowB.length) {
      return true;
    }
    for (let ci = 0; ci < rowA.length; ci++) {
      if (rowA[ci] !== rowB[ci]) {
        return true;
      }
    }
  }
  return false;
}
