import { markdown } from "@codemirror/lang-markdown";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextMenuItem } from "../lib/context-menu";
import { markdownExtensions } from "../parser";
import { tableDiscoveryField } from "../state/table-discovery";
import { createTestView } from "../test-utils";
import { findCellBounds, findTablesInState, type TableRange } from "./table-discovery";
import {
  buildTableGridContextMenuItems,
  type TableGridContextMenuActions,
} from "./table-grid-context-menu";
import type { ParsedTable } from "./table-utils";

const DOC = [
  "before",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "after",
].join("\n");

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function makeView(): EditorView {
  return createTestView(DOC, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      tableDiscoveryField,
    ],
  });
}

function getTable(target: EditorView): TableRange {
  const table = findTablesInState(target.state)[0];
  expect(table).toBeDefined();
  if (!table) {
    throw new Error("expected a parsed table");
  }
  return table;
}

function selectTableCell(
  target: EditorView,
  tableLineIndex: number,
  colIndex: number,
): void {
  const table = getTable(target);
  const line = target.state.doc.line(table.startLineNumber + tableLineIndex);
  const bounds = findCellBounds(line.text, line.from, colIndex);
  expect(bounds).not.toBeNull();
  if (!bounds) {
    throw new Error("expected cell bounds");
  }

  target.dispatch({
    selection: { anchor: bounds.from },
    scrollIntoView: false,
  });
}

function getMenuItem(items: readonly ContextMenuItem[], label: string): ContextMenuItem {
  const item = items.find((candidate) => candidate.label === label);
  expect(item).toBeDefined();
  if (!item) {
    throw new Error(`expected menu item ${label}`);
  }
  return item;
}

interface CapturedAction {
  readonly kind: "mutate" | "delete";
  readonly table: TableRange;
  readonly parsed?: ParsedTable;
}

function createCapturingActions(calls: CapturedAction[]): TableGridContextMenuActions {
  return {
    mutateTable(_view, table, mutate) {
      calls.push({
        kind: "mutate",
        table,
        parsed: mutate(table.parsed),
      });
    },
    deleteTable(_view, table) {
      calls.push({ kind: "delete", table });
    },
  };
}

describe("buildTableGridContextMenuItems", () => {
  it("uses the editor selection for header row and column disabled states", () => {
    view = makeView();
    const table = getTable(view);
    const calls: CapturedAction[] = [];
    selectTableCell(view, 0, 1);

    const items = buildTableGridContextMenuItems(
      view,
      table,
      createCapturingActions(calls),
    );

    expect(getMenuItem(items, "Insert Row Above").disabled).toBe(true);
    expect(getMenuItem(items, "Delete Row").disabled).toBe(true);
    expect(getMenuItem(items, "Move Row Up").disabled).toBe(true);
    expect(getMenuItem(items, "Move Row Down").disabled).toBe(true);
    expect(getMenuItem(items, "Delete Column").disabled).toBe(false);
    expect(getMenuItem(items, "Align Right").disabled).toBe(false);
  });

  it("runs table mutation actions through the supplied dispatcher", () => {
    view = makeView();
    const table = getTable(view);
    const calls: CapturedAction[] = [];
    selectTableCell(view, 2, 0);

    const items = buildTableGridContextMenuItems(
      view,
      table,
      createCapturingActions(calls),
    );
    getMenuItem(items, "Insert Row Below").action?.();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("mutate");
    expect(calls[0]?.table).toBe(table);
    expect(calls[0]?.parsed?.rows.map((row) =>
      row.cells.map((cell) => cell.content),
    )).toEqual([
      ["1", "2"],
      ["", ""],
      ["3", "4"],
    ]);
  });

  it("runs delete table through the supplied dispatcher", () => {
    view = makeView();
    const table = getTable(view);
    const calls: CapturedAction[] = [];
    selectTableCell(view, 2, 0);

    const items = buildTableGridContextMenuItems(
      view,
      table,
      createCapturingActions(calls),
    );
    getMenuItem(items, "Delete Table").action?.();

    expect(calls).toEqual([{ kind: "delete", table }]);
  });
});
