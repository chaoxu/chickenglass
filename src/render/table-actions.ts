import type { EditorView } from "@codemirror/view";
import { ContextMenu } from "../app/context-menu";
import type { ContextMenuItem } from "../app/context-menu";
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  moveColumn,
  moveRow,
  setAlignment,
  type ParsedTable,
  formatTable,
} from "./table-utils";
import {
  getCursorColIndex,
  getCursorRowIndex,
  type TableRange,
} from "./table-discovery";

/** Apply a mutation to a table and replace its text in the document. */
export function applyTableMutation(
  view: EditorView,
  table: TableRange,
  mutate: (parsed: ParsedTable) => ParsedTable,
): void {
  const newTable = mutate(table.parsed);
  const newLines = formatTable(newTable);
  const newText = newLines.join("\n");

  view.dispatch({
    changes: { from: table.from, to: table.to, insert: newText },
  });
}

function buildTableContextMenuItems(
  view: EditorView,
  table: TableRange,
): ContextMenuItem[] {
  const cursorRow = getCursorRowIndex(view, table);
  const cursorCol = getCursorColIndex(view, table);

  return [
    {
      label: "Insert Row Above",
      disabled: cursorRow === null,
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addRow(parsed, cursorRow ?? 0),
        );
      },
    },
    {
      label: "Insert Row Below",
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addRow(parsed, cursorRow !== null ? cursorRow + 1 : undefined),
        );
      },
    },
    {
      label: "Insert Column Left",
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addColumn(parsed, cursorCol ?? 0),
        );
      },
    },
    {
      label: "Insert Column Right",
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addColumn(parsed, cursorCol !== null ? cursorCol + 1 : undefined),
        );
      },
    },
    { label: "-" },
    {
      label: "Delete Row",
      disabled: cursorRow === null || table.parsed.rows.length === 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (parsed) => deleteRow(parsed, cursorRow));
      },
    },
    {
      label: "Delete Column",
      disabled: cursorCol === null || table.parsed.header.cells.length <= 1,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (parsed) => deleteColumn(parsed, cursorCol));
      },
    },
    { label: "-" },
    {
      label: "Align Left",
      disabled: cursorCol === null,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (parsed) => setAlignment(parsed, cursorCol, "left"));
      },
    },
    {
      label: "Align Center",
      disabled: cursorCol === null,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (parsed) => setAlignment(parsed, cursorCol, "center"));
      },
    },
    {
      label: "Align Right",
      disabled: cursorCol === null,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (parsed) => setAlignment(parsed, cursorCol, "right"));
      },
    },
    { label: "-" },
    {
      label: "Move Row Up",
      disabled: cursorRow === null || cursorRow <= 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (parsed) => moveRow(parsed, cursorRow, cursorRow - 1));
      },
    },
    {
      label: "Move Row Down",
      disabled: cursorRow === null || cursorRow >= table.parsed.rows.length - 1,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (parsed) => moveRow(parsed, cursorRow, cursorRow + 1));
      },
    },
    {
      label: "Move Column Left",
      disabled: cursorCol === null || cursorCol <= 0,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (parsed) => moveColumn(parsed, cursorCol, cursorCol - 1));
      },
    },
    {
      label: "Move Column Right",
      disabled: cursorCol === null || cursorCol >= table.parsed.header.cells.length - 1,
      action: () => {
        if (cursorCol === null) return;
        applyTableMutation(view, table, (parsed) => moveColumn(parsed, cursorCol, cursorCol + 1));
      },
    },
  ];
}

function buildWidgetContextMenuItems(
  view: EditorView,
  table: TableRange,
  section: string,
  row: number,
  col: number,
): ContextMenuItem[] {
  const cursorRow = section === "header" ? null : row;
  const cursorCol = col;

  return [
    {
      label: "Insert Row Above",
      disabled: cursorRow === null,
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addRow(parsed, cursorRow ?? 0),
        );
      },
    },
    {
      label: "Insert Row Below",
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addRow(parsed, cursorRow !== null ? cursorRow + 1 : undefined),
        );
      },
    },
    {
      label: "Insert Column Left",
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addColumn(parsed, cursorCol),
        );
      },
    },
    {
      label: "Insert Column Right",
      action: () => {
        applyTableMutation(view, table, (parsed) =>
          addColumn(parsed, cursorCol + 1),
        );
      },
    },
    { label: "-" },
    {
      label: "Delete Row",
      disabled: cursorRow === null || table.parsed.rows.length === 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (parsed) => deleteRow(parsed, cursorRow));
      },
    },
    {
      label: "Delete Column",
      disabled: table.parsed.header.cells.length <= 1,
      action: () => {
        applyTableMutation(view, table, (parsed) => deleteColumn(parsed, cursorCol));
      },
    },
    { label: "-" },
    {
      label: "Align Left",
      action: () => {
        applyTableMutation(view, table, (parsed) => setAlignment(parsed, cursorCol, "left"));
      },
    },
    {
      label: "Align Center",
      action: () => {
        applyTableMutation(view, table, (parsed) => setAlignment(parsed, cursorCol, "center"));
      },
    },
    {
      label: "Align Right",
      action: () => {
        applyTableMutation(view, table, (parsed) => setAlignment(parsed, cursorCol, "right"));
      },
    },
    { label: "-" },
    {
      label: "Move Row Up",
      disabled: cursorRow === null || cursorRow <= 0,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (parsed) => moveRow(parsed, cursorRow, cursorRow - 1));
      },
    },
    {
      label: "Move Row Down",
      disabled: cursorRow === null || cursorRow >= table.parsed.rows.length - 1,
      action: () => {
        if (cursorRow === null) return;
        applyTableMutation(view, table, (parsed) => moveRow(parsed, cursorRow, cursorRow + 1));
      },
    },
    {
      label: "Move Column Left",
      disabled: cursorCol <= 0,
      action: () => {
        applyTableMutation(view, table, (parsed) => moveColumn(parsed, cursorCol, cursorCol - 1));
      },
    },
    {
      label: "Move Column Right",
      disabled: cursorCol >= table.parsed.header.cells.length - 1,
      action: () => {
        applyTableMutation(view, table, (parsed) => moveColumn(parsed, cursorCol, cursorCol + 1));
      },
    },
  ];
}

/** Show a context menu for a table at the given screen coordinates. */
export function showTableContextMenu(
  view: EditorView,
  table: TableRange,
  x: number,
  y: number,
): void {
  new ContextMenu(buildTableContextMenuItems(view, table), x, y);
}

/**
 * Show a context menu for a widget table cell using explicit coordinates.
 *
 * Unlike the editor-selection variant, this takes explicit section/row/col
 * from the widget's data attributes — needed because the widget has
 * `ignoreEvent()` returning true, so the root CM6 cursor may not be
 * positioned inside the table.
 */
export function showWidgetContextMenu(
  view: EditorView,
  table: TableRange,
  section: string,
  row: number,
  col: number,
  x: number,
  y: number,
): void {
  new ContextMenu(buildWidgetContextMenuItems(view, table, section, row, col), x, y);
}
