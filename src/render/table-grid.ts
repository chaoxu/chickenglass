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
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import {
  Annotation,
  EditorState,
  RangeSetBuilder,
  type ChangeDesc,
  type Range,
  type RangeSet,
} from "@codemirror/state";
import {
  findTablesInState,
  findTableAtCursor,
  findPipePositions,
  type TableRange,
} from "./table-discovery";
import { tableDiscoveryField } from "../state/table-discovery";
import { createSimpleTextWidget } from "./render-core";
import {
  containsPosExclusiveEnd,
  rangesIntersect,
} from "../lib/range-helpers";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import {
  formatTable,
  type ParsedTable,
} from "./table-utils";
import {
  mergeRanges,
  normalizeDirtyRange,
  type VisibleRange,
} from "./viewport-diff";
import { findCellAtPos, getCellBounds } from "./table-cell-geometry";
import { tableClipboardHandlers } from "./table-clipboard";
import { tableGridClickGuard } from "./table-grid-click-guard";
import { createTableGridContextMenuHandler } from "./table-grid-context-menu";
import { createTableGridKeyBindings } from "./table-grid-navigation";

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
function buildTableGridArtifacts(
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
  for (const range of dirtyRanges) {
    if (rangesIntersect(table, range)) return true;
    if (range.from >= table.to) break;
  }
  return false;
}

function computeDirtyTableGridUpdate(
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
  const target = { from, to };
  for (const range of dirtyRanges) {
    if (from === to) {
      if (containsPosExclusiveEnd(range, from)) return true;
    } else if (rangesIntersect(target, range)) {
      return true;
    }

    if (range.from > to) break;
  }
  return false;
}

function updateTableGridArtifacts(
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

function tableDiscoveryChanged(update: ViewUpdate): boolean {
  return (
    update.state.field(tableDiscoveryField, false)
    !== update.startState.field(tableDiscoveryField, false)
  );
}

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

const gridContextMenuHandler = createTableGridContextMenuHandler({
  mutateTable: dispatchTableMutation,
  deleteTable: dispatchDeleteTable,
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
    const overlapsRow = rangesIntersect(
      { from, to },
      { from: line.from, to: lineDeleteTo },
    );

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
    tables: readonly TableRange[];
    constructor(view: EditorView) {
      this.tables = findTablesInState(view.state);
      const artifacts = buildTableGridArtifacts(view.state, this.tables);
      this.decorations = artifacts.structuralDecorations;
      this.outerDecorations = artifacts.cellDecorations;
      this.atomicRanges = artifacts.atomicRanges;
    }
    update(update: ViewUpdate) {
      if (tableDiscoveryChanged(update)) {
        const nextTables = findTablesInState(update.state);
        const artifacts = updateTableGridArtifacts(
          {
            structuralDecorations: this.decorations,
            cellDecorations: this.outerDecorations,
            atomicRanges: this.atomicRanges,
          },
          this.tables,
          nextTables,
          update.state,
          update.changes,
        );
        this.decorations = artifacts.structuralDecorations;
        this.outerDecorations = artifacts.cellDecorations;
        this.atomicRanges = artifacts.atomicRanges;
        this.tables = nextTables;
      } else if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.outerDecorations = this.outerDecorations.map(update.changes);
        this.atomicRanges = this.atomicRanges.map(update.changes);
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

export const _computeDirtyTableGridUpdateForTest = computeDirtyTableGridUpdate;

const tableGridTheme = EditorView.baseTheme({
  ".cf-grid-pipe": { display: "none" },
  ".cf-grid-row .cm-widgetBuffer": { display: "none" },

  /* Search highlights: cell marks use outerDecorations so they wrap around
   * search marks. No special handling needed — the standard CM6 search
   * highlight classes render inside the grid cells correctly. */

  ".cf-grid-row": {
    gap: "0",
    borderLeft: "1px solid var(--cf-border)",
    borderRight: "1px solid var(--cf-border)",
    borderTop: "1px solid var(--cf-border)",
    padding: "0 !important",
    gridTemplateRows: "auto",
    gridAutoRows: "0",
  },
  ".cf-grid-row-last": { borderBottom: "1px solid var(--cf-border)" },
  ".cf-grid-header": {
    fontWeight: "700",
    backgroundColor: "var(--cf-bg-secondary)",
    borderBottom: "2px solid var(--cf-border)",
  },
  ".cf-grid-cell": {
    padding: "4px 0",
    borderRight: "1px solid var(--cf-border)",
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
  tableGridClickGuard,
  gridContextMenuHandler,
  keymap.of(createTableGridKeyBindings(deleteSelectedTableSelection)),
  pipeProtectionFilter,
];
