import { Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, RangeSetBuilder, type ChangeDesc, type Range, type RangeSet } from "@codemirror/state";
import { createSimpleTextWidget } from "./render-core";
import { findCellAtPos, getCellBounds } from "./table-cell-geometry";
import { findTableAtCursor, findPipePositions, findTablesInState, type TableRange } from "./table-discovery";
import { mergeRanges, normalizeDirtyRange, rangeIntersectsRanges, type VisibleRange } from "./viewport-diff";
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

/** Check if pos is in a structural zone. Uses pre-computed tables to avoid tree walks. */
export function isStructuralAt(
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

export interface TableGridArtifacts {
  readonly structuralDecorations: DecorationSet;
  readonly cellDecorations: DecorationSet;
  readonly atomicRanges: RangeSet<Decoration>;
}

interface DirtyTableGridUpdate {
  readonly dirtyRanges: readonly VisibleRange[];
  readonly dirtyTables: readonly TableRange[];
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
export function buildTableGridArtifacts(
  state: EditorState,
  tables: readonly TableRange[] = findTablesInState(state),
): TableGridArtifacts {
  const structuralBuilder = new RangeSetBuilder<Decoration>();
  const cellBuilder = new RangeSetBuilder<Decoration>();
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (const table of tables) {
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

function mapTableToDirtyRange(
  table: TableRange,
  changes: ChangeDesc,
  docLength: number,
): VisibleRange {
  return normalizeDirtyRange(
    changes.mapPos(table.from, 1),
    changes.mapPos(table.to, -1),
    docLength,
  );
}

function tableIntersectsDirtyRanges(
  table: TableRange,
  dirtyRanges: readonly VisibleRange[],
): boolean {
  return rangeIntersectsRanges(table.from, table.to, dirtyRanges);
}

export function computeDirtyTableGridUpdate(
  previousTables: readonly TableRange[],
  nextTables: readonly TableRange[],
  changes: ChangeDesc,
  docLength: number,
): DirtyTableGridUpdate {
  const previousByLines = new Map<readonly string[], TableRange>();
  for (const table of previousTables) {
    previousByLines.set(table.lines, table);
  }

  const preservedTables: TableRange[] = [];
  const retainedLines = new Set<readonly string[]>();
  const dirtyRanges: VisibleRange[] = [];
  const dirtyTables: TableRange[] = [];

  for (const table of nextTables) {
    const previous = previousByLines.get(table.lines);
    if (previous) {
      preservedTables.push(table);
      retainedLines.add(table.lines);
      continue;
    }
    dirtyTables.push(table);
    dirtyRanges.push(normalizeDirtyRange(table.from, table.to, docLength));
  }

  for (const table of previousTables) {
    if (retainedLines.has(table.lines)) continue;
    dirtyRanges.push(mapTableToDirtyRange(table, changes, docLength));
  }

  let mergedDirtyRanges = mergeRanges(dirtyRanges);
  if (mergedDirtyRanges.length > 0) {
    // A preserved table can shift into a dirty window after an adjacent
    // table is removed or rebuilt. Rebuild those overlaps to avoid
    // filtering away their mapped line decorations.
    for (const table of preservedTables) {
      if (!tableIntersectsDirtyRanges(table, mergedDirtyRanges)) continue;
      dirtyTables.push(table);
      mergedDirtyRanges = mergeRanges([
        ...mergedDirtyRanges,
        normalizeDirtyRange(table.from, table.to, docLength),
      ]);
    }
  }

  return {
    dirtyRanges: mergedDirtyRanges,
    dirtyTables: [...dirtyTables].sort((left, right) => left.from - right.from),
  };
}

function artifactsToRanges(
  artifacts: TableGridArtifacts,
  docLength: number,
): {
  readonly structuralDecorations: readonly Range<Decoration>[];
  readonly cellDecorations: readonly Range<Decoration>[];
  readonly atomicRanges: readonly Range<Decoration>[];
} {
  const structuralDecorations: Range<Decoration>[] = [];
  const cellDecorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];

  artifacts.structuralDecorations.between(0, docLength, (from, to, value) => {
    structuralDecorations.push(value.range(from, to));
  });
  artifacts.cellDecorations.between(0, docLength, (from, to, value) => {
    cellDecorations.push(value.range(from, to));
  });
  artifacts.atomicRanges.between(0, docLength, (from, to, value) => {
    atomicRanges.push(value.range(from, to));
  });

  return {
    structuralDecorations,
    cellDecorations,
    atomicRanges,
  };
}

function rangeTouchesDirtyRanges(
  from: number,
  to: number,
  dirtyRanges: readonly VisibleRange[],
): boolean {
  return rangeIntersectsRanges(from, to, dirtyRanges);
}

export function updateTableGridArtifacts(
  artifacts: TableGridArtifacts,
  previousTables: readonly TableRange[],
  nextTables: readonly TableRange[],
  state: EditorState,
  changes: ChangeDesc,
): TableGridArtifacts {
  const mappedArtifacts = {
    structuralDecorations: artifacts.structuralDecorations.map(changes),
    cellDecorations: artifacts.cellDecorations.map(changes),
    atomicRanges: artifacts.atomicRanges.map(changes),
  } satisfies TableGridArtifacts;

  const dirtyUpdate = computeDirtyTableGridUpdate(
    previousTables,
    nextTables,
    changes,
    state.doc.length,
  );
  if (dirtyUpdate.dirtyRanges.length === 0) {
    return mappedArtifacts;
  }

  const replacementArtifacts = buildTableGridArtifacts(state, dirtyUpdate.dirtyTables);
  const replacementRanges = artifactsToRanges(replacementArtifacts, state.doc.length);
  const firstDirtyRange = dirtyUpdate.dirtyRanges[0];
  const lastDirtyRange = dirtyUpdate.dirtyRanges[dirtyUpdate.dirtyRanges.length - 1];
  if (!firstDirtyRange || !lastDirtyRange) {
    return mappedArtifacts;
  }

  const filterFrom = firstDirtyRange.from;
  const filterTo = lastDirtyRange.to;
  const keepRange = (from: number, to: number) => !rangeTouchesDirtyRanges(
    from,
    to,
    dirtyUpdate.dirtyRanges,
  );

  return {
    structuralDecorations: mappedArtifacts.structuralDecorations.update({
      filterFrom,
      filterTo,
      filter: keepRange,
      add: replacementRanges.structuralDecorations,
      sort: true,
    }),
    cellDecorations: mappedArtifacts.cellDecorations.update({
      filterFrom,
      filterTo,
      filter: keepRange,
      add: replacementRanges.cellDecorations,
      sort: true,
    }),
    atomicRanges: mappedArtifacts.atomicRanges.update({
      filterFrom,
      filterTo,
      filter: keepRange,
      add: replacementRanges.atomicRanges,
      sort: true,
    }),
  };
}

