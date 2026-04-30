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
  EditorView,
  keymap,
} from "@codemirror/view";
import {
  Annotation,
  EditorState,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  findTablesInState,
  findTableAtCursor,
  type TableRange,
} from "./table-discovery";
import { tableDiscoveryField } from "../state/table-discovery";
import { rangesIntersect } from "../lib/range-helpers";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import {
  formatTable,
  type ParsedTable,
} from "./table-utils";
import {
  buildTableGridArtifacts,
  computeDirtyTableGridUpdate,
  isStructuralAt,
  updateTableGridArtifacts,
  type TableGridArtifacts,
} from "./table-grid-artifacts";
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

interface TableGridState extends TableGridArtifacts {
  readonly tables: readonly TableRange[];
}

function buildTableGridState(state: EditorState): TableGridState {
  const tables = findTablesInState(state);
  return {
    tables,
    ...buildTableGridArtifacts(state, tables),
  };
}

function tableDiscoveryChanged(
  update: Pick<Transaction, "state" | "startState">,
): boolean {
  return (
    update.state.field(tableDiscoveryField, false)
    !== update.startState.field(tableDiscoveryField, false)
  );
}

/** Structural decorations: pipe replacements, line classes, separator hiding.
 *  Also provides atomicRanges so CM6 cursor motion skips structural zones. */
const tableGridField = StateField.define<TableGridState>({
  create: buildTableGridState,
  update(value, tr) {
    if (tableDiscoveryChanged(tr)) {
      const nextTables = findTablesInState(tr.state);
      return {
        tables: nextTables,
        ...updateTableGridArtifacts(
          value,
          value.tables,
          nextTables,
          tr.state,
          tr.changes,
        ),
      };
    }
    if (tr.docChanged) {
      return {
        tables: value.tables,
        structuralDecorations: value.structuralDecorations.map(tr.changes),
        cellDecorations: value.cellDecorations.map(tr.changes),
        atomicRanges: value.atomicRanges.map(tr.changes),
      };
    }
    return value;
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (value) => value.structuralDecorations),
      EditorView.outerDecorations.from(field, (value) => value.cellDecorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).atomicRanges),
    ];
  },
});

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
  tableGridField,
  tableGridTheme,
  tableClipboardHandlers,
  tableGridClickGuard,
  gridContextMenuHandler,
  keymap.of(createTableGridKeyBindings(deleteSelectedTableSelection)),
  pipeProtectionFilter,
];
