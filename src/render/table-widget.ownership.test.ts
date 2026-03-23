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

const createInlineEditorMock = vi.fn();
const renderInlineMarkdownMock = vi.fn((
  element: HTMLElement,
  content: string,
  _macros: Record<string, string>,
) => {
  element.textContent = content;
});

vi.mock("../editor/inline-editor", () => ({
  createInlineEditor: (options: unknown) => createInlineEditorMock(options),
}));

vi.mock("./inline-render", () => ({
  renderInlineMarkdown: (
    element: HTMLElement,
    content: string,
    macros: Record<string, string>,
  ) => renderInlineMarkdownMock(element, content, macros),
}));

vi.mock("./table-discovery", () => ({
  findTablesInState: (state: { __tables?: Array<{ from: number; to: number }> }) =>
    state.__tables ?? [],
  findClosestTable: (
    tables: Array<{ from: number; to: number }>,
    tableFrom: number,
  ) => tables.find((table) => table.from === tableFrom) ?? null,
  findClosestWidgetContainer: () => null,
}));

const { TableWidget } = await import("./table-widget");

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

function makeInlineEditor(docText: string): EditorView {
  return createMockEditorView({
    state: {
      doc: {
        toString: () => docText,
        length: docText.length,
      },
      selection: { main: { head: 0 } },
    },
    destroy: vi.fn(),
    dispatch: vi.fn(),
    focus: vi.fn(),
    posAtCoords: () => null,
  });
}


describe("TableWidget cross-widget editor ownership", () => {
  beforeEach(() => {
    createInlineEditorMock.mockReset();
    renderInlineMarkdownMock.mockClear();
  });

  it("commits the previous editor through its owning widget when switching tables", () => {
    const tableText = "| A |\n|---|\n| old |";
    const viewA = makeRootView(10, tableText);
    const viewB = makeRootView(40, tableText);
    const inlineA = makeInlineEditor("edited A");
    const inlineB = makeInlineEditor("edited B");
    createInlineEditorMock
      .mockReturnValueOnce(inlineA)
      .mockReturnValueOnce(inlineB);

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
    cellB.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(viewA.dispatch).toHaveBeenCalledTimes(1);
    expect(viewB.dispatch).not.toHaveBeenCalled();
    expect(inlineA.destroy).toHaveBeenCalledTimes(1);
    expect(renderInlineMarkdownMock).toHaveBeenCalledWith(cellA, "edited A", {
      "\\A": "\\alpha",
    });

    widgetB.destroy(domB);
    widgetA.destroy(domA);
  });
});
