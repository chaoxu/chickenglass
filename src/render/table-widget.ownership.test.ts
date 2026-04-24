import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { ParsedTable } from "./table-utils";
import { createMockEditorView } from "../test-utils";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

interface MockInlineController {
  readonly view: EditorView;
  readonly setCallbacks: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

const createInlineEditorControllerMock = vi.fn<
  (options: unknown) => MockInlineController
>();

vi.mock("../inline-editor", () => ({
  createInlineEditorController: (options: unknown) =>
    createInlineEditorControllerMock(options),
}));

vi.mock("./table-discovery", () => ({
  tableDiscoveryField: [],
  findTablesInState: (state: { __tables?: Array<{ from: number; to: number }> }) =>
    state.__tables ?? [],
  findClosestTable: (
    tables: Array<{ from: number; to: number }>,
    tableFrom: number,
  ) => tables.find((table) => table.from === tableFrom) ?? null,
  findClosestWidgetContainer: () => null,
}));

const { TableWidget } = await import("./table-widget");

function readRenderSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function makeTable(): ParsedTable {
  return {
    header: { cells: [{ content: "A" }] },
    alignments: ["none"],
    rows: [{ cells: [{ content: "old" }] }],
  };
}

function makeRootView(tableFrom: number, tableText: string): EditorView {
  return createMockEditorView({
    state: {
      __tables: [{ from: tableFrom, to: tableFrom + tableText.length }],
      sliceDoc: () => tableText,
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    requestMeasure: vi.fn(),
  });
}

function makeInlineController(docText: string): MockInlineController {
  const view = createMockEditorView({
    state: {
      doc: {
        toString: () => docText,
        length: docText.length,
      },
      selection: { main: { head: 0, from: 0, to: 0 } },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    posAtCoords: () => null,
  });

  return {
    view,
    setCallbacks: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("TableWidget cross-widget editor ownership", () => {
  beforeEach(() => {
    createInlineEditorControllerMock.mockReset();
  });

  it("creates editors on demand and commits through the owning widget when switching tables", () => {
    const tableText = "| A |\n|---|\n| old |";
    const viewA = makeRootView(10, tableText);
    const viewB = makeRootView(40, tableText);
    const bodyA = makeInlineController("edited A");
    const bodyB = makeInlineController("edited B");
    createInlineEditorControllerMock
      .mockReturnValueOnce(bodyA)
      .mockReturnValueOnce(bodyB);

    const widgetA = new TableWidget(makeTable(), tableText, 10, { "\\A": "\\alpha" });
    const widgetB = new TableWidget(makeTable(), tableText, 40, { "\\B": "\\beta" });
    const domA = widgetA.toDOM(viewA);
    const domB = widgetB.toDOM(viewB);
    const cellA = domA.querySelector("td");
    const cellB = domB.querySelector("td");
    if (!cellA || !cellB) {
      throw new Error("expected table cells to exist");
    }

    expect(createInlineEditorControllerMock).toHaveBeenCalledTimes(0);

    cellA.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    cellB.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(createInlineEditorControllerMock).toHaveBeenCalledTimes(2);
    expect(bodyA.destroy).toHaveBeenCalledTimes(1);
    expect(bodyB.destroy).not.toHaveBeenCalled();
    expect(viewA.dispatch).toHaveBeenCalledTimes(1);
    expect(viewB.dispatch).not.toHaveBeenCalled();

    widgetB.destroy(domB);
    widgetA.destroy(domA);
  });

  it("destroys the owning controller when an active widget is torn down", () => {
    const tableText = "| A |\n|---|\n| old |";
    const viewA = makeRootView(10, tableText);
    const viewB = makeRootView(40, tableText);
    const bodyA = makeInlineController("edited A");
    const bodyB = makeInlineController("edited B");
    createInlineEditorControllerMock
      .mockReturnValueOnce(bodyA)
      .mockReturnValueOnce(bodyB);

    const widgetA = new TableWidget(makeTable(), tableText, 10, { "\\A": "\\alpha" });
    const widgetB = new TableWidget(makeTable(), tableText, 40, { "\\B": "\\beta" });
    const domA = widgetA.toDOM(viewA);
    const domB = widgetB.toDOM(viewB);
    const cellA = domA.querySelector("td");
    const cellB = domB.querySelector("td");
    if (!cellA || !cellB) {
      throw new Error("expected table cells to exist");
    }

    cellA.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    cellA.remove();

    widgetA.destroy(domA);

    expect(viewA.dispatch).not.toHaveBeenCalled();
    expect(bodyA.destroy).toHaveBeenCalledTimes(1);

    cellB.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(createInlineEditorControllerMock).toHaveBeenCalledTimes(2);
    expect(bodyB.destroy).not.toHaveBeenCalled();

    widgetB.destroy(domB);
  });

  it("destroys the active controller when updateDOM rebuilds the widget", () => {
    const tableText = "| A |\n|---|\n| old |";
    const view = makeRootView(10, tableText);
    const oldBody = makeInlineController("edited A");
    createInlineEditorControllerMock
      .mockReturnValueOnce(oldBody);

    const oldWidget = new TableWidget(makeTable(), tableText, 10, { "\\A": "\\alpha" });
    const dom = oldWidget.toDOM(view);
    const cell = dom.querySelector("td");
    if (!cell) {
      throw new Error("expected table cell to exist");
    }

    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    const updatedTable: ParsedTable = {
      header: { cells: [{ content: "A" }] },
      alignments: ["none"],
      rows: [{ cells: [{ content: "new" }] }],
    };
    const newWidget = new TableWidget(updatedTable, "| A |\n|---|\n| new |", 10, { "\\A": "\\alpha" });

    expect(newWidget.updateDOM(dom, view, oldWidget)).toBe(true);
    expect(oldBody.destroy).toHaveBeenCalledTimes(1);
    expect(createInlineEditorControllerMock).toHaveBeenCalledTimes(1);

    newWidget.destroy(dom);
  });
});

describe("TableWidget module ownership", () => {
  it("keeps DOM construction and mutation flows out of the shell widget", () => {
    const source = readRenderSource("src/render/table-widget.ts");

    expect(source.split(/\r?\n/).length).toBeLessThan(600);
    expect(source).toContain("buildTableWidgetDOM");
    expect(source).not.toContain("createInlineEditorController");
    expect(source).not.toContain("applyTableMutation");
    expect(source).not.toContain("showWidgetContextMenu");
    expect(source).not.toContain('document.createElement("table")');
    expect(source).not.toContain('addEventListener("contextmenu"');
  });
});
