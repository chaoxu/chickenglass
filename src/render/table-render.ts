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
  StateField,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { buildDecorations, editorFocusField, focusTracker } from "./render-utils";
import { mathMacrosField } from "./math-macros";
import { findTableAtCursor, findTablesInState, findTablesInView } from "./table-discovery";
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
  const items: Range<Decoration>[] = [];

  for (const table of tables) {
    const tableText = state.sliceDoc(table.from, table.to);
    const widget = new TableWidget(table.parsed, tableText, table.from, macros);

    items.push(
      Decoration.replace({
        widget,
        block: true,
      }).range(table.from, table.to),
    );
  }

  return buildDecorations(items);
}

/**
 * CM6 StateField that provides table rendering decorations.
 *
 * Uses a StateField (not ViewPlugin) so that block-level replace decorations
 * (which cross line breaks) are permitted by CM6.
 */
const tableDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorationsFromState(state);
  },

  update(value, tr) {
    if (tr.annotation(cellEditAnnotation)) {
      return value.map(tr.changes);
    }

    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return buildTableDecorationsFromState(tr.state);
    }
    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
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
    view.dispatch({ selection: { anchor: pos } });
    showTableContextMenu(view, table, event.clientX, event.clientY);
    return true;
  },
});

/** CM6 extension for interactive table editing. */
export const tableRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mathMacrosField,
  tableDecorationField,
  tableContextMenuHandler,
  tableKeybindings,
];
