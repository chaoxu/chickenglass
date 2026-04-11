export interface TableDraft {
  readonly alignments: ReadonlyArray<"center" | "left" | "right" | null>;
  readonly dividerCells?: ReadonlyArray<string>;
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
    headers: draft.headers.map((cell, index) => (index === columnIndex ? nextValue : cell)),
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
    rows: draft.rows.map((row, rowDraftIndex) =>
      rowDraftIndex === rowIndex
        ? row.map((cell, cellIndex) => (cellIndex === columnIndex ? nextValue : cell))
        : row,
    ),
  };
}
