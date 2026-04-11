import {
  StateField,
  type EditorState,
  type Text,
  type Transaction,
} from "@codemirror/state";
import {
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { rangesOverlap } from "../lib/range-helpers";
import { mergeRanges } from "../render/viewport-diff";
import { parseTable, type ParsedTable } from "../render/table-utils";

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

interface DirtyRange {
  readonly from: number;
  readonly to: number;
}

const TABLE_STRUCTURE_RE = /[|:\-\n\r]/;

function getParsedTableLineCount(parsed: ParsedTable): number {
  return 2 + parsed.rows.length;
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

  const lineCount = getParsedTableLineCount(parsed);
  const lastTableLine = doc.line(Math.min(doc.lines, startLine.number + lineCount - 1));
  const tableLines = lines.slice(0, lineCount);
  const sepLine = doc.line(startLine.number + 1);
  const separatorFrom = sepLine.from;
  const separatorTo = sepLine.to < doc.length ? sepLine.to + 1 : sepLine.to;

  return {
    from: tableFrom,
    to: lastTableLine.to,
    separatorFrom,
    separatorTo,
    parsed,
    lines: tableLines,
    startLineNumber: startLine.number,
  };
}

function collectTables(
  state: EditorState,
  ranges?: readonly DirtyRange[],
): readonly TableRange[] {
  const tables: TableRange[] = [];
  const seen = new Set<number>();
  const tree = syntaxTree(state);

  const collectInRange = (from?: number, to?: number) => {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Table" || seen.has(node.from)) return;
        seen.add(node.from);
        const table = createTableRange(state.doc, node.from, node.to);
        if (table) tables.push(table);
      },
    });
  };

  if (ranges) {
    for (const range of ranges) {
      collectInRange(range.from, range.to);
    }
    tables.sort((left, right) => left.from - right.from);
    return tables;
  }

  collectInRange();
  return tables;
}

function mapTableRange(table: TableRange, tr: Transaction): TableRange {
  const from = tr.changes.mapPos(table.from);
  const to = tr.changes.mapPos(table.to);
  const separatorFrom = tr.changes.mapPos(table.separatorFrom);
  const separatorTo = tr.changes.mapPos(table.separatorTo);
  const startLineNumber = tr.state.doc.lineAt(Math.min(from, tr.state.doc.length)).number;

  if (
    from === table.from &&
    to === table.to &&
    separatorFrom === table.separatorFrom &&
    separatorTo === table.separatorTo &&
    startLineNumber === table.startLineNumber
  ) {
    return table;
  }

  return {
    ...table,
    from,
    to,
    separatorFrom,
    separatorTo,
    startLineNumber,
  };
}

function mapTableRanges(
  tables: readonly TableRange[],
  tr: Transaction,
): readonly TableRange[] {
  let changed = false;
  const mapped = tables.map((table) => {
    const next = mapTableRange(table, tr);
    if (next !== table) changed = true;
    return next;
  });
  return changed ? mapped : tables;
}

function expandChangedRangeToNearbyLines(
  doc: Text,
  from: number,
  to: number,
): DirtyRange {
  if (doc.length === 0) {
    return { from: 0, to: 0 };
  }

  const startLine = doc.lineAt(Math.min(from, doc.length));
  const endLine = doc.lineAt(Math.min(Math.max(from, to), doc.length));
  const expandedStart = doc.line(Math.max(1, startLine.number - 1)).from;
  const expandedEnd = doc.line(Math.min(doc.lines, endLine.number + 1)).to;

  return { from: expandedStart, to: expandedEnd };
}

function changeCouldAffectTableStructure(
  change: { readonly from: number; readonly to: number; readonly inserted: Text },
): boolean {
  if (change.from !== change.to) {
    return true;
  }
  return TABLE_STRUCTURE_RE.test(change.inserted.toString());
}

function canSkipLocalTableRebuild(
  tables: readonly TableRange[],
  tr: Transaction,
): boolean {
  let canSkip = true;

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!canSkip) return;
    if (changeCouldAffectTableStructure({ from: fromA, to: toA, inserted })) {
      canSkip = false;
      return;
    }

    const expanded = expandChangedRangeToNearbyLines(tr.startState.doc, fromA, toA);
    for (const table of tables) {
      if (table.from > expanded.to) break;
      if (!rangesOverlap(table, expanded)) continue;
      canSkip = false;
      return;
    }
  }, true);

  return canSkip;
}

function computeDirtyRanges(
  tables: readonly TableRange[],
  tr: Transaction,
): readonly DirtyRange[] {
  const tree = syntaxTree(tr.state);
  const dirtyRanges: DirtyRange[] = [];

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const expanded = expandChangedRangeToNearbyLines(tr.state.doc, fromB, toB);
    let dirtyFrom = expanded.from;
    let dirtyTo = expanded.to;

    for (const table of tables) {
      if (table.from > toA) break;
      if (!rangesOverlap(table, { from: fromA, to: toA })) continue;
      dirtyFrom = Math.min(dirtyFrom, tr.changes.mapPos(table.from));
      dirtyTo = Math.max(dirtyTo, tr.changes.mapPos(table.to));
    }

    tree.iterate({
      from: dirtyFrom,
      to: dirtyTo,
      enter(node) {
        if (node.name !== "Table") return;
        dirtyFrom = Math.min(dirtyFrom, node.from);
        dirtyTo = Math.max(dirtyTo, node.to);
        return false;
      },
    });

    dirtyRanges.push({ from: dirtyFrom, to: dirtyTo });
  });

  return mergeRanges(dirtyRanges, 1);
}

function tableOverlapsDirtyRanges(
  table: TableRange,
  dirtyRanges: readonly DirtyRange[],
): boolean {
  for (const range of dirtyRanges) {
    if (range.to < table.from) continue;
    if (range.from > table.to) break;
    if (rangesOverlap(table, range)) return true;
  }
  return false;
}

function incrementalTableDiscoveryUpdate(
  tables: readonly TableRange[],
  tr: Transaction,
): readonly TableRange[] {
  const mappedTables = mapTableRanges(tables, tr);
  if (canSkipLocalTableRebuild(tables, tr)) {
    return mappedTables;
  }

  const dirtyRanges = computeDirtyRanges(tables, tr);
  const rebuiltTables = collectTables(tr.state, dirtyRanges);
  const preservedTables: TableRange[] = [];

  for (const mapped of mappedTables) {
    if (tableOverlapsDirtyRanges(mapped, dirtyRanges)) continue;
    preservedTables.push(mapped);
  }

  if (
    rebuiltTables.length === 0 &&
    preservedTables.length === mappedTables.length &&
    preservedTables.every((table, index) => table === mappedTables[index])
  ) {
    return mappedTables;
  }

  return [...preservedTables, ...rebuiltTables].sort((left, right) => left.from - right.from);
}

export function updateDiscoveredTables(
  tables: readonly TableRange[],
  tr: Transaction,
  treeAvailable = syntaxTreeAvailable(tr.state, tr.state.doc.length),
): readonly TableRange[] {
  const finish = (next: readonly TableRange[]): readonly TableRange[] => (
    sameDiscoveredTables(tables, next) ? tables : next
  );

  if (!tr.docChanged) {
    if (
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
      && treeAvailable
    ) {
      return finish(collectTables(tr.state));
    }
    return tables;
  }

  if (!treeAvailable) {
    return finish(canSkipLocalTableRebuild(tables, tr)
      ? mapTableRanges(tables, tr)
      : collectTables(tr.state));
  }

  return finish(incrementalTableDiscoveryUpdate(tables, tr));
}

export function computePendingTableParse(
  tables: readonly TableRange[],
  tr: Transaction,
  treeAvailable = syntaxTreeAvailable(tr.state, tr.state.doc.length),
): boolean {
  if (treeAvailable) {
    return false;
  }

  if (!tr.docChanged) {
    return false;
  }

  return !canSkipLocalTableRebuild(tables, tr);
}

export function sameDiscoveredTables(
  before: readonly TableRange[],
  after: readonly TableRange[],
): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i += 1) {
    const ta = before[i];
    const tb = after[i];
    if (ta.from !== tb.from || ta.to !== tb.to) return false;
    if (
      ta.separatorFrom !== tb.separatorFrom ||
      ta.separatorTo !== tb.separatorTo ||
      ta.startLineNumber !== tb.startLineNumber
    ) {
      return false;
    }
    if (ta.lines.length !== tb.lines.length) return false;
    for (let j = 0; j < ta.lines.length; j += 1) {
      if (ta.lines[j] !== tb.lines[j]) return false;
    }
  }
  return true;
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
    return updateDiscoveredTables(value, tr);
  },

  compare(a, b) {
    return sameDiscoveredTables(a, b);
  },
});

export const tableDiscoveryPendingParseField = StateField.define<boolean>({
  create() {
    return false;
  },

  update(_value, tr) {
    const tables = tr.startState.field(tableDiscoveryField, false) ?? collectTables(tr.startState);
    return computePendingTableParse(tables, tr);
  },
});

/**
 * Find all tables using the syntax tree from EditorState.
 * Unlike the view-based helper, this does not filter by visible ranges
 * since StateFields operate on the full document.
 */
export function findTablesInState(state: EditorState): readonly TableRange[] {
  return state.field(tableDiscoveryField, false) ?? collectTables(state);
}
