import { markdown } from "@codemirror/lang-markdown";
import { forceParsing } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdownExtensions } from "../parser";
import { createTestView } from "../test-utils";
import { tableDiscoveryField } from "../state/table-discovery";
import { findCellBounds, findTablesInState } from "./table-discovery";
import {
  addRow,
  deleteColumn,
  formatTable,
  moveRow,
  setAlignment,
} from "./table-utils";

interface CapturedMenuItem {
  label: string;
  disabled?: boolean;
  action?: () => void;
}

interface CapturedMenu {
  items: CapturedMenuItem[];
  x: number;
  y: number;
}

const { contextMenus } = vi.hoisted(() => ({
  contextMenus: [] as CapturedMenu[],
}));

vi.mock("../lib/context-menu", () => ({
  ContextMenu: class {
    constructor(items: CapturedMenuItem[], x: number, y: number) {
      contextMenus.push({ items, x, y });
    }

    dismiss() {}
  },
}));

const { applyTableMutation, showTableContextMenu, showWidgetContextMenu } =
  await import("./table-actions");

const DOC = [
  "before",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "| 3 | 4 |",
  "after",
].join("\n");

let view: EditorView | undefined;

function makeView(doc = DOC): EditorView {
  const nextView = createTestView(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      tableDiscoveryField,
    ],
  });
  forceParsing(nextView, nextView.state.doc.length, 5000);
  return nextView;
}

function getTable(target: EditorView) {
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
  edge: "from" | "to" = "from",
): void {
  const table = getTable(target);
  const line = target.state.doc.line(table.startLineNumber + tableLineIndex);
  const bounds = findCellBounds(line.text, line.from, colIndex);
  expect(bounds).not.toBeNull();
  if (!bounds) {
    throw new Error("expected cell bounds");
  }

  target.dispatch({
    selection: { anchor: bounds[edge] },
    scrollIntoView: false,
  });
}

function getLatestMenu(): CapturedMenu {
  const menu = contextMenus.at(-1);
  expect(menu).toBeDefined();
  if (!menu) {
    throw new Error("expected a captured context menu");
  }
  return menu;
}

function getMenuItem(menu: CapturedMenu, label: string): CapturedMenuItem {
  const item = menu.items.find((candidate) => candidate.label === label);
  expect(item).toBeDefined();
  if (!item) {
    throw new Error(`expected menu item ${label}`);
  }
  return item;
}

function expectDocWithMutatedTable(
  target: EditorView,
  newTableText: string,
  originalFrom: number,
  originalTo: number,
): void {
  const prefix = DOC.slice(0, originalFrom);
  const suffix = DOC.slice(originalTo);
  expect(target.state.doc.toString()).toBe(prefix + newTableText + suffix);
}

describe("table-actions", () => {
  beforeEach(() => {
    contextMenus.length = 0;
  });

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("replaces exactly the table text range when applying a mutation", () => {
    view = makeView();
    const table = getTable(view);
    const prefix = view.state.sliceDoc(0, table.from);
    const suffix = view.state.sliceDoc(table.to);
    const expectedTable = formatTable(addRow(table.parsed, 0)).join("\n");

    applyTableMutation(view, table, (parsed) => addRow(parsed, 0));

    expect(view.state.doc.sliceString(0, table.from)).toBe(prefix);
    expect(view.state.doc.sliceString(view.state.doc.length - suffix.length)).toBe(suffix);
    expect(view.state.doc.toString()).toBe(prefix + expectedTable + suffix);
  });

  it("disables row-targeted selection menu items when the cursor is on the header", () => {
    view = makeView();
    const table = getTable(view);
    selectTableCell(view, 0, 1);

    showTableContextMenu(view, table, 12, 34);

    const menu = getLatestMenu();
    expect(menu.x).toBe(12);
    expect(menu.y).toBe(34);
    expect(getMenuItem(menu, "Insert Row Above").disabled).toBe(true);
    expect(getMenuItem(menu, "Delete Row").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Row Up").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Row Down").disabled).toBe(true);
    expect(getMenuItem(menu, "Delete Column").disabled).toBe(false);
    expect(getMenuItem(menu, "Align Right").disabled).toBe(false);
  });

  it("uses the editor selection for boundary states and row insertion actions", () => {
    view = makeView();
    const table = getTable(view);
    selectTableCell(view, 2, 0);

    showTableContextMenu(view, table, 20, 40);

    const menu = getLatestMenu();
    expect(getMenuItem(menu, "Move Row Up").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Column Left").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Row Down").disabled).toBe(false);
    expect(getMenuItem(menu, "Move Column Right").disabled).toBe(false);

    const expectedTable = formatTable(addRow(table.parsed, 1)).join("\n");
    getMenuItem(menu, "Insert Row Below").action?.();

    expectDocWithMutatedTable(view, expectedTable, table.from, table.to);
  });

  it("dispatches alignment mutations for the selected column", () => {
    view = makeView();
    const table = getTable(view);
    selectTableCell(view, 2, 1);

    showTableContextMenu(view, table, 24, 48);

    const expectedTable = formatTable(setAlignment(table.parsed, 1, "right")).join("\n");
    getMenuItem(getLatestMenu(), "Align Right").action?.();

    expectDocWithMutatedTable(view, expectedTable, table.from, table.to);
  });

  it("uses explicit widget body coordinates instead of the root selection", () => {
    view = makeView();
    const table = getTable(view);
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: false });

    showWidgetContextMenu(view, table, "body", 1, 1, 30, 60);

    const menu = getLatestMenu();
    expect(getMenuItem(menu, "Delete Row").disabled).toBe(false);
    expect(getMenuItem(menu, "Move Row Up").disabled).toBe(false);
    expect(getMenuItem(menu, "Move Row Down").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Column Left").disabled).toBe(false);
    expect(getMenuItem(menu, "Move Column Right").disabled).toBe(true);

    const expectedTable = formatTable(moveRow(table.parsed, 1, 0)).join("\n");
    getMenuItem(menu, "Move Row Up").action?.();

    expectDocWithMutatedTable(view, expectedTable, table.from, table.to);
  });

  it("treats widget header cells as rowless and uses the explicit column for column actions", () => {
    view = makeView();
    const table = getTable(view);
    selectTableCell(view, 2, 0);

    showWidgetContextMenu(view, table, "header", 99, 1, 36, 72);

    const menu = getLatestMenu();
    expect(getMenuItem(menu, "Insert Row Above").disabled).toBe(true);
    expect(getMenuItem(menu, "Delete Row").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Row Up").disabled).toBe(true);
    expect(getMenuItem(menu, "Move Row Down").disabled).toBe(true);

    const expectedTable = formatTable(deleteColumn(table.parsed, 1)).join("\n");
    getMenuItem(menu, "Delete Column").action?.();

    expectDocWithMutatedTable(view, expectedTable, table.from, table.to);
  });
});
