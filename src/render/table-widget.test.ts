import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  TableWidget,
  serializeTableWidgetMacros,
  shouldCommitBlurredInlineEditor,
} from "./table-widget";
import type { ParsedTable } from "./table-utils";
import { createMockEditorView } from "../test-utils";

// jsdom lacks ResizeObserver — provide a no-op stub.
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];

  disconnect = vi.fn();

  constructor() {
    ResizeObserverStub.instances.push(this);
  }

  observe() {}
  unobserve() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/** Minimal parsed table for testing. */
function makeTable(): ParsedTable {
  return {
    header: { cells: [{ content: "A" }, { content: "B" }] },
    alignments: ["none", "none"],
    rows: [{ cells: [{ content: "1" }, { content: "2" }] }],
  };
}

/** Stub EditorView with just enough shape for toDOM(). */
function makeStubView(): EditorView {
  return createMockEditorView();
}

describe("TableWidget source range attributes", () => {
  it("treats macro order as irrelevant when computing the widget signature", () => {
    expect(
      serializeTableWidgetMacros({ "\\A": "1", "\\B": "2" }),
    ).toBe(
      serializeTableWidgetMacros({ "\\B": "2", "\\A": "1" }),
    );
  });

  it("sets data-source-from and data-source-to on the container", () => {
    const tableText = "| A | B |\n|---|---|\n| 1 | 2 |";
    const tableFrom = 42;
    const widget = new TableWidget(makeTable(), tableText, tableFrom, {});
    const dom = widget.toDOM(makeStubView());

    expect(dom.dataset.sourceFrom).toBe("42");
    expect(dom.dataset.sourceTo).toBe(String(42 + tableText.length));
  });

  it("computes sourceTo from tableFrom + tableText.length", () => {
    const tableText = "| X |\n|---|\n| Y |";
    const tableFrom = 100;
    const table: ParsedTable = {
      header: { cells: [{ content: "X" }] },
      alignments: ["none"],
      rows: [{ cells: [{ content: "Y" }] }],
    };
    const widget = new TableWidget(table, tableText, tableFrom, {});
    const dom = widget.toDOM(makeStubView());

    expect(dom.dataset.sourceFrom).toBe("100");
    expect(dom.dataset.sourceTo).toBe(String(100 + tableText.length));
  });

  it("is discoverable via [data-source-from] selector", () => {
    const tableText = "| A | B |\n|---|---|\n| 1 | 2 |";
    const widget = new TableWidget(makeTable(), tableText, 0, {});
    const dom = widget.toDOM(makeStubView());

    // Mount into a parent so querySelector works
    const parent = document.createElement("div");
    parent.appendChild(dom);

    const found = parent.querySelectorAll<HTMLElement>("[data-source-from]");
    expect(found).toHaveLength(1);
    expect(found[0].dataset.sourceFrom).toBe("0");
    expect(found[0].dataset.sourceTo).toBe(String(tableText.length));
  });

  it("rebuilds when macro content changes even if the table text is unchanged", () => {
    const widgetA = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, { "\\RR": "\\mathbb{R}" });
    const widgetB = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, { "\\NN": "\\mathbb{N}" });

    expect(widgetA.eq(widgetB)).toBe(false);
  });

  it("disconnects its ResizeObserver when the widget is destroyed", () => {
    ResizeObserverStub.instances.length = 0;
    const widget = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
    const dom = widget.toDOM(makeStubView());
    const observer = ResizeObserverStub.instances.at(-1);

    expect(observer).toBeDefined();
    widget.destroy(dom);

    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("table-widget blur ownership", () => {
  function makeEditor(cell: HTMLElement) {
    return {
      view: {} as EditorView,
      cell,
      owner: {} as TableWidget,
    };
  }

  it("commits when the blurred editor is still the active one", () => {
    const cell = document.createElement("td");
    const editor = makeEditor(cell);

    expect(shouldCommitBlurredInlineEditor(editor, editor, cell)).toBe(true);
  });

  it("skips commit when another cell became active before the timeout fires", () => {
    const blurredCell = document.createElement("td");
    const nextCell = document.createElement("td");
    const blurredEditor = makeEditor(blurredCell);
    const nextEditor = makeEditor(nextCell);

    expect(
      shouldCommitBlurredInlineEditor(blurredEditor, nextEditor, blurredCell),
    ).toBe(false);
  });

  it("skips commit when the original editor is already gone", () => {
    const cell = document.createElement("td");
    const editor = makeEditor(cell);

    expect(shouldCommitBlurredInlineEditor(editor, null, cell)).toBe(false);
  });

  describe("negative / edge-case", () => {
    it("skips commit when the blurred cell is different from the cell the editor was tracking", () => {
      const cell = document.createElement("td");
      const otherCell = document.createElement("td");
      const editor = makeEditor(cell);

      // The editor's cell is `cell` but the blur event comes from `otherCell`
      expect(shouldCommitBlurredInlineEditor(editor, editor, otherCell)).toBe(false);
    });
  });
});

describe("TableWidget negative / edge-case", () => {
  it("eq returns true for identical widget instances", () => {
    const text = "| A |\n|---|\n| 1 |";
    const widgetA = new TableWidget(makeTable(), text, 0, {});
    const widgetB = new TableWidget(makeTable(), text, 0, {});
    expect(widgetA.eq(widgetB)).toBe(true);
  });

  it("eq returns true even when tableFrom differs (position is not part of identity)", () => {
    // eq() only checks tableText and macroSignature; tableFrom is updated lazily
    // in toDOM() via bestTable heuristic, not used for widget identity.
    const text = "| A |\n|---|\n| 1 |";
    const widgetA = new TableWidget(makeTable(), text, 0, {});
    const widgetB = new TableWidget(makeTable(), text, 10, {});
    expect(widgetA.eq(widgetB)).toBe(true);
  });

  it("eq returns false when table text differs", () => {
    const widgetA = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
    const widgetB = new TableWidget(makeTable(), "| B |\n|---|\n| 2 |", 0, {});
    expect(widgetA.eq(widgetB)).toBe(false);
  });

  it("serializeTableWidgetMacros returns consistent string for empty macros", () => {
    expect(serializeTableWidgetMacros({})).toBe(serializeTableWidgetMacros({}));
  });
});
