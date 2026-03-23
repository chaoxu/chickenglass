import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { TableWidget, shouldCommitBlurredInlineEditor } from "./table-widget";
import type { ParsedTable } from "./table-utils";

// jsdom lacks ResizeObserver — provide a no-op stub.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
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
  return {
    state: {
      sliceDoc: () => "",
      doc: { toString: () => "" },
      selection: { main: { head: 0, from: 0, to: 0 } },
    },
    dispatch: () => {},
    focus: () => {},
    requestMeasure: () => {},
    contentDOM: document.createElement("div"),
  } as unknown as EditorView;
}

describe("TableWidget source range attributes", () => {
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
});

describe("table-widget blur ownership", () => {
  function makeEditor(cell: HTMLElement) {
    return {
      view: {} as EditorView,
      cell,
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
});
