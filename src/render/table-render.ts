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
} from "@codemirror/state";
import { buildDecorations } from "./decoration-core";
import { createDecorationStateField } from "./decoration-field";
import { editorFocusField, focusTracker } from "./focus-state";
import {
  getTableReferenceRenderDependencySignature,
  tableReferenceRenderDependenciesChanged,
} from "../state/reference-render-state";
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
  return table.from < to && from < table.to;
}

function updateTableDecorationsForDiscoveryChange(
  value: DecorationSet,
  startState: EditorState,
  state: EditorState,
): DecorationSet {
  const beforeTables = findTablesInState(startState);
  const afterTables = findTablesInState(state);
  const afterSet = new Set(afterTables);
  const beforeSet = new Set(beforeTables);
  const removedTables = beforeTables.filter((table) => !afterSet.has(table));
  const addedTables = afterTables.filter((table) => !beforeSet.has(table));

  if (removedTables.length === 0 && addedTables.length === 0) {
    return value;
  }

  const affectedTables = [...removedTables, ...addedTables];
  const filterFrom = Math.min(...affectedTables.map((table) => table.from));
  const filterTo = Math.max(...affectedTables.map((table) => table.to));
  const macros = state.field(mathMacrosField);
  const renderSignature = getTableReferenceRenderDependencySignature(state);

  return value.update({
    filterFrom,
    filterTo,
    filter(from, to) {
      return !affectedTables.some((table) => rangeTouchesTable(from, to, table));
    },
    add: addedTables.map((table) =>
      buildTableDecorationRange(state, table, macros, renderSignature)
    ),
    sort: true,
  });
}

/**
 * CM6 StateField that provides table rendering decorations.
 *
 * Uses a StateField (not ViewPlugin) so that block-level replace decorations
 * (which cross line breaks) are permitted by CM6.
 */
const tableDecorationField = createDecorationStateField({
  create(state) {
    return buildTableDecorationsFromState(state);
  },

  update(value, tr) {
    const cellEdit = tr.annotation(cellEditAnnotation);
    const referenceDepsChanged = tableReferenceRenderDependenciesChanged(
      tr.startState,
      tr.state,
    );
    const tableDiscoveryChanged =
      tr.state.field(tableDiscoveryField, false) !== tr.startState.field(tableDiscoveryField, false);

    // Live keystrokes inside the inline cell editor: map existing
    // decorations through the change so the widget (and its nested
    // editor) survives. Commits trigger a full rebuild below.
    if (cellEdit === "edit") {
      return value.map(tr.changes);
    }

    if (
      cellEdit === "commit" ||
      referenceDepsChanged ||
      tableDiscoveryChanged
    ) {
      if (!referenceDepsChanged && tableDiscoveryChanged && cellEdit !== "commit") {
        return updateTableDecorationsForDiscoveryChange(value, tr.startState, tr.state);
      }
      return buildTableDecorationsFromState(tr.state);
    }
    if (tr.docChanged) {
      return value.map(tr.changes);
    }
    return value;
  },

});

/** Standalone DOM event handler for table context menus. */
const tableContextMenuHandler: Extension = EditorView.domEventHandlers({
  contextmenu(event: MouseEvent, view: EditorView) {
    const tables = findTablesInView(view);
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
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
