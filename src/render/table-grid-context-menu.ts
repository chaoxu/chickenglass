import { EditorView } from "@codemirror/view";
import { ContextMenu } from "../lib/context-menu";
import type { ContextMenuItem } from "../lib/context-menu";
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  moveColumn,
  moveRow,
  setAlignment,
  type ParsedTable,
} from "./table-utils";
import {
  findTableAtCursor,
  findTablesInState,
  getCursorColIndex,
  getCursorRowIndex,
  type TableRange,
} from "./table-discovery";
import { guardTableGridMousePosition } from "./table-grid-click-guard";

export interface TableGridContextMenuActions {
  readonly mutateTable: (
    view: EditorView,
    table: TableRange,
    mutate: (parsed: ParsedTable) => ParsedTable,
  ) => void;
  readonly deleteTable: (view: EditorView, table: TableRange) => void;
}

function getCursorPosition(
  view: EditorView,
  table: TableRange,
): { rowIndex: number | null; colIndex: number | null } {
  const rowIndex = getCursorRowIndex(view, table);
  const colIndex = getCursorColIndex(view, table);
  return { rowIndex, colIndex };
}

export function buildTableGridContextMenuItems(
  view: EditorView,
  table: TableRange,
  actions: TableGridContextMenuActions,
): ContextMenuItem[] {
  const { rowIndex, colIndex } = getCursorPosition(view, table);

  return [
    {
      label: "Insert Row Above",
      disabled: rowIndex === null,
      action: () => {
        actions.mutateTable(view, table, (parsed) =>
          addRow(parsed, rowIndex ?? 0),
        );
      },
    },
    {
      label: "Insert Row Below",
      action: () => {
        actions.mutateTable(view, table, (parsed) =>
          addRow(parsed, rowIndex !== null ? rowIndex + 1 : undefined),
        );
      },
    },
    {
      label: "Insert Column Left",
      action: () => {
        actions.mutateTable(view, table, (parsed) =>
          addColumn(parsed, colIndex ?? 0),
        );
      },
    },
    {
      label: "Insert Column Right",
      action: () => {
        actions.mutateTable(view, table, (parsed) =>
          addColumn(parsed, colIndex !== null ? colIndex + 1 : undefined),
        );
      },
    },
    { label: "-" },
    {
      label: "Delete Row",
      disabled: rowIndex === null || table.parsed.rows.length === 0,
      action: () => {
        if (rowIndex === null) return;
        actions.mutateTable(view, table, (parsed) => deleteRow(parsed, rowIndex));
      },
    },
    {
      label: "Delete Column",
      disabled: colIndex === null || table.parsed.header.cells.length <= 1,
      action: () => {
        if (colIndex === null) return;
        actions.mutateTable(view, table, (parsed) => deleteColumn(parsed, colIndex));
      },
    },
    { label: "-" },
    {
      label: "Align Left",
      disabled: colIndex === null,
      action: () => {
        if (colIndex === null) return;
        actions.mutateTable(view, table, (parsed) => setAlignment(parsed, colIndex, "left"));
      },
    },
    {
      label: "Align Center",
      disabled: colIndex === null,
      action: () => {
        if (colIndex === null) return;
        actions.mutateTable(view, table, (parsed) => setAlignment(parsed, colIndex, "center"));
      },
    },
    {
      label: "Align Right",
      disabled: colIndex === null,
      action: () => {
        if (colIndex === null) return;
        actions.mutateTable(view, table, (parsed) => setAlignment(parsed, colIndex, "right"));
      },
    },
    { label: "-" },
    {
      label: "Move Row Up",
      disabled: rowIndex === null || rowIndex <= 0,
      action: () => {
        if (rowIndex === null) return;
        actions.mutateTable(view, table, (parsed) => moveRow(parsed, rowIndex, rowIndex - 1));
      },
    },
    {
      label: "Move Row Down",
      disabled: rowIndex === null || rowIndex >= table.parsed.rows.length - 1,
      action: () => {
        if (rowIndex === null) return;
        actions.mutateTable(view, table, (parsed) => moveRow(parsed, rowIndex, rowIndex + 1));
      },
    },
    {
      label: "Move Column Left",
      disabled: colIndex === null || colIndex <= 0,
      action: () => {
        if (colIndex === null) return;
        actions.mutateTable(view, table, (parsed) => moveColumn(parsed, colIndex, colIndex - 1));
      },
    },
    {
      label: "Move Column Right",
      disabled: colIndex === null || colIndex >= table.parsed.header.cells.length - 1,
      action: () => {
        if (colIndex === null) return;
        actions.mutateTable(view, table, (parsed) => moveColumn(parsed, colIndex, colIndex + 1));
      },
    },
    { label: "-" },
    {
      label: "Delete Table",
      action: () => actions.deleteTable(view, table),
    },
  ];
}

export function createTableGridContextMenuHandler(
  actions: TableGridContextMenuActions,
) {
  return EditorView.domEventHandlers({
    contextmenu(event: MouseEvent, view: EditorView) {
      const tables = findTablesInState(view.state);
      const corrected = guardTableGridMousePosition(view, event);
      const pos = corrected ?? view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const table = findTableAtCursor(tables, pos);
      if (!table) return false;

      event.preventDefault();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
      new ContextMenu(
        buildTableGridContextMenuItems(view, table, actions),
        event.clientX,
        event.clientY,
      );
      return true;
    },
  });
}
