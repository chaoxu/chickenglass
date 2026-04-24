/**
 * CM6 StateField for interactive table rendering.
 *
 * The table subsystem is intentionally split into smaller layers:
 * - table-discovery.ts: syntax-tree discovery and shared position helpers
 * - table-actions.ts: mutation helpers and context-menu actions
 * - table-navigation.ts: root-editor keybindings
 * - table-widget.ts: rendered table widget and inline cell editor controller
 *
 * This file stays as the thin assembly layer that wires those pieces into
 * one CM6 extension.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  type Transaction,
} from "@codemirror/state";
import { buildDecorations } from "./decoration-core";
import { createLifecycleDecorationStateField } from "./decoration-field";
import { editorFocusField, focusTracker } from "./focus-state";
import {
  getTableReferenceRenderDependencySignature,
  tableReferenceRenderDependenciesChanged,
} from "../state/reference-render-state";
import { preciseHitTestPosition } from "../lib/editor-hit-test";
import {
  findTableAtCursor,
  findTablesInState,
  findTablesInView,
  tableDiscoveryParsePlugin,
} from "./table-discovery";
import { mathMacrosField } from "../state/math-macros";
import {
  tableDiscoveryField,
  tableDiscoveryPendingParseField,
  type TableRange,
} from "../state/table-discovery";
import { showTableContextMenu } from "./table-actions";
import { tableKeybindings } from "./table-navigation";
import { cellEditAnnotation, TableWidget } from "./table-widget";

/**
 * Insert a blank table at the cursor position.
 *
 * @param view - The editor view.
 * @param rows - Number of data rows (default 3).
 * @param cols - Number of columns (default 3).
 */
export function insertTable(
  view: EditorView,
  rows = 3,
  cols = 3,
): void {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const prefix = line.text.trim() === "" && from === line.from ? "" : "\n";

  const header = "| " + Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(" | ") + " |";
  const separator = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const emptyRow = "| " + Array.from({ length: cols }, () => "   ").join(" | ") + " |";
  const dataRows = Array.from({ length: rows }, () => emptyRow).join("\n");

  const tableText = `${prefix}${header}\n${separator}\n${dataRows}\n`;

  view.dispatch({
    changes: { from, to, insert: tableText },
    selection: { anchor: from + prefix.length + header.length + 1 + separator.length + 1 + 2 },
  });
  view.focus();
}

/**
 * Build table decorations from EditorState.
 *
 * For each table: always replace with a rendered HTML <table> via TableWidget.
 * Cell editing happens via nested InlineEditor instances inside the widget.
 */
function buildTableDecorationsFromState(state: EditorState): DecorationSet {
  const tables = findTablesInState(state);
  const macros = state.field(mathMacrosField);
  const renderSignature = getTableReferenceRenderDependencySignature(state);
  const items: Range<Decoration>[] = [];

  for (const table of tables) {
    items.push(buildTableDecorationRange(state, table, macros, renderSignature));
  }

  return buildDecorations(items);
}

function buildTableDecorationRange(
  state: EditorState,
  table: TableRange,
  macros: Record<string, string>,
  renderSignature: string,
): Range<Decoration> {
  const tableText = state.sliceDoc(table.from, table.to);
  const widget = new TableWidget(
    table.parsed,
    tableText,
    table.from,
    macros,
    renderSignature,
  );

  return Decoration.replace({
    widget,
    block: true,
  }).range(table.from, table.to);
}

function rangeTouchesTable(
  from: number,
  to: number,
  table: Pick<TableRange, "from" | "to">,
): boolean {
  if (from === to && table.from === table.to) {
    return from === table.from;
  }
  if (from === to) {
    return table.from <= from && from <= table.to;
  }
  if (table.from === table.to) {
    return from <= table.from && table.from <= to;
  }
  return table.from < to && from < table.to;
}

function mapTableRangeForDecorations(
  table: Pick<TableRange, "from" | "to">,
  tr: Transaction,
): Pick<TableRange, "from" | "to"> {
  return {
    from: tr.changes.mapPos(table.from),
    to: tr.changes.mapPos(table.to),
  };
}

function tableRenderContentKey(table: TableRange): string {
  return table.lines.join("\u0000");
}

function mappedTableRangeKey(
  table: Pick<TableRange, "from" | "to">,
): string {
  return `${table.from}:${table.to}`;
}

function mappedTableRenderKey(
  table: TableRange,
  tr: Transaction,
): string {
  const mapped = mapTableRangeForDecorations(table, tr);
  return `${mappedTableRangeKey(mapped)}:${tableRenderContentKey(table)}`;
}

function tableMayRenderReferences(
  state: EditorState,
  table: Pick<TableRange, "from" | "to">,
): boolean {
  return state.sliceDoc(table.from, table.to).includes("@");
}

function collectAffectedTableRenderRanges(
  tr: Transaction,
): readonly Pick<TableRange, "from" | "to">[] {
  const { startState, state } = tr;
  const beforeTables = findTablesInState(startState);
  const afterTables = findTablesInState(state);
  const unchangedAfterTables = new Set<TableRange>();
  const availableBeforeTablesByKey = new Map<string, TableRange[]>();

  for (const beforeTable of beforeTables) {
    const key = mappedTableRenderKey(beforeTable, tr);
    const tables = availableBeforeTablesByKey.get(key);
    if (tables) {
      tables.push(beforeTable);
    } else {
      availableBeforeTablesByKey.set(key, [beforeTable]);
    }
  }

  for (const afterTable of afterTables) {
    const key = `${mappedTableRangeKey(afterTable)}:${tableRenderContentKey(afterTable)}`;
    const unchangedBeforeTables = availableBeforeTablesByKey.get(key);
    const unchangedBeforeTable = unchangedBeforeTables?.pop();

    if (unchangedBeforeTable && unchangedBeforeTables) {
      unchangedAfterTables.add(afterTable);
      if (unchangedBeforeTables.length === 0) {
        availableBeforeTablesByKey.delete(key);
      }
    }
  }

  const removedOrChangedTables = [...availableBeforeTablesByKey.values()]
    .flat()
    .map((table) => mapTableRangeForDecorations(table, tr));
  const addedOrChangedTables = afterTables
    .filter((table) => !unchangedAfterTables.has(table));
  return [...removedOrChangedTables, ...addedOrChangedTables];
}

function collectTablesInDirtyRanges(
  state: EditorState,
  dirtyRanges: readonly Pick<TableRange, "from" | "to">[],
): Range<Decoration>[] {
  if (dirtyRanges.length === 0) return [];

  const tables = findTablesInState(state).filter((table) =>
    dirtyRanges.some((range) => rangeTouchesTable(range.from, range.to, table))
  );

  const macros = state.field(mathMacrosField);
  const renderSignature = getTableReferenceRenderDependencySignature(state);
  return tables.map((table) =>
    buildTableDecorationRange(state, table, macros, renderSignature)
  );
}

/**
 * CM6 StateField that provides table rendering decorations.
 *
 * Uses a StateField (not ViewPlugin) so that block-level replace decorations
 * (which cross line breaks) are permitted by CM6.
 */
const tableDecorationField = createLifecycleDecorationStateField<Pick<TableRange, "from" | "to">>({
  spanName: "cm6.tableDecorations",
  build(state) {
    return buildTableDecorationsFromState(state);
  },

  collectRanges(state, dirtyRanges) {
    return collectTablesInDirtyRanges(state, dirtyRanges);
  },

  semanticChanged(beforeState, afterState) {
    return (
      tableReferenceRenderDependenciesChanged(beforeState, afterState) ||
      afterState.field(tableDiscoveryField, false) !== beforeState.field(tableDiscoveryField, false)
    );
  },

  shouldRebuild(tr) {
    const cellEdit = tr.annotation(cellEditAnnotation);
    if (cellEdit === "commit") return true;
    if (cellEdit === "edit") return false;

    const tableDiscoveryChanged =
      tr.state.field(tableDiscoveryField, false) !== tr.startState.field(tableDiscoveryField, false);
    const referenceDepsChanged = tableReferenceRenderDependenciesChanged(
      tr.startState,
      tr.state,
    );
    return tableDiscoveryChanged && referenceDepsChanged;
  },

  dirtyRangeFn(tr) {
    if (tr.annotation(cellEditAnnotation) === "edit") return [];

    const tableDiscoveryChanged =
      tr.state.field(tableDiscoveryField, false) !== tr.startState.field(tableDiscoveryField, false);
    if (tableDiscoveryChanged) {
      return collectAffectedTableRenderRanges(tr);
    }

    if (tableReferenceRenderDependenciesChanged(tr.startState, tr.state)) {
      return findTablesInState(tr.state).filter((table) =>
        tableMayRenderReferences(tr.state, table)
      );
    }

    return [];
  },

  mapDecorations(value, tr) {
    return tr.docChanged ? value.map(tr.changes) : value;
  },
});

/** Standalone DOM event handler for table context menus. */
const tableContextMenuHandler: Extension = EditorView.domEventHandlers({
  contextmenu(event: MouseEvent, view: EditorView) {
    const tables = findTablesInView(view);
    const pos = preciseHitTestPosition(view, { x: event.clientX, y: event.clientY })?.pos ?? null;
    if (pos === null) return false;
    const table = findTableAtCursor(tables, pos);
    if (!table) return false;

    event.preventDefault();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    showTableContextMenu(view, table, event.clientX, event.clientY);
    return true;
  },
});

export { tableDecorationField as _tableDecorationFieldForTest };

/** CM6 extension for interactive table editing. */
export const tableRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mathMacrosField,
  tableDiscoveryField,
  tableDiscoveryPendingParseField,
  tableDiscoveryParsePlugin,
  tableDecorationField,
  tableContextMenuHandler,
  tableKeybindings,
];
