import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import {
  TableWidget,
  cellEditAnnotation,
  shouldCommitBlurredInlineEditor,
} from "./table-widget";
import { _tableDecorationFieldForTest as tableDecorationField } from "./table-render";
import { editorFocusField } from "./render-utils";
import { mathMacrosField } from "./math-macros";
import { frontmatterField } from "../editor/frontmatter-state";
import { markdownExtensions } from "../parser";
import type { ParsedTable } from "./table-utils";
import { createMockEditorView, createEditorState, getDecorationSpecs } from "../test-utils";

// jsdom lacks ResizeObserver — provide a no-op stub.
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  private readonly callback: ResizeObserverCallback;

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  trigger(entries: ResizeObserverEntry[] = []): void {
    this.callback(entries, this as unknown as ResizeObserver);
  }
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

function makeMeasureAwareView() {
  const requestMeasure = vi.fn((spec?: {
    read?: () => unknown;
    write?: (value: unknown) => void;
  }) => {
    const measured = spec?.read?.();
    spec?.write?.(measured);
  });

  const view = createMockEditorView({
    requestMeasure,
    state: {
      doc: { toString: () => "", length: 0 },
    },
  });

  Object.assign(view, {
    scrollDOM: { scrollTop: 0 },
    lineBlockAtHeight: vi.fn(() => ({ from: 0 })),
    coordsAtPos: vi.fn(() => ({ top: 0 })),
  });

  return { view, requestMeasure };
}

describe("TableWidget source range attributes", () => {
  it("treats macro order as irrelevant when comparing widget identity", () => {
    const widgetA = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {
      "\\A": "1",
      "\\B": "2",
    });
    const widgetB = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {
      "\\B": "2",
      "\\A": "1",
    });

    expect(widgetA.eq(widgetB)).toBe(true);
  });

  it("sets data-source-from and data-source-to on the container", () => {
    const tableText = "| A | B |\n|---|---|\n| 1 | 2 |";
    const tableFrom = 42;
    const widget = new TableWidget(makeTable(), tableText, tableFrom, {});
    const dom = widget.toDOM(makeStubView());

    expect(dom.dataset.sourceFrom).toBe("42");
    expect(dom.dataset.sourceTo).toBe(String(42 + tableText.length));
    expect(dom.dataset.shellFrom).toBe("42");
    expect(dom.dataset.shellTo).toBe(String(42 + tableText.length));
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

  it("skips the initial ResizeObserver callback and coalesces later remeasures", () => {
    ResizeObserverStub.instances.length = 0;
    let pendingFrame: FrameRequestCallback | null = null;
    const requestAnimationFrameSpy = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        pendingFrame = callback;
        return 1;
      });
    const cancelAnimationFrameSpy = vi.spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => {});

    try {
      const { view, requestMeasure } = makeMeasureAwareView();
      const widget = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
      widget.toDOM(view);
      const observer = ResizeObserverStub.instances.at(-1);

      expect(observer).toBeDefined();
      requestAnimationFrameSpy.mockClear();

      observer?.trigger();
      expect(requestMeasure).not.toHaveBeenCalled();

      observer?.trigger();
      observer?.trigger();
      expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
      expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();
      expect(requestMeasure).not.toHaveBeenCalled();

      const frame = pendingFrame as FrameRequestCallback | null;
      if (!frame) {
        throw new Error("expected a pending resize frame");
      }
      frame(0);
      expect(requestMeasure).toHaveBeenCalledTimes(1);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("disconnects the old ResizeObserver and reattaches on updateDOM reuse", () => {
    ResizeObserverStub.instances.length = 0;

    const oldWidget = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
    const dom = oldWidget.toDOM(makeStubView());
    const oldObserver = ResizeObserverStub.instances.at(-1);

    const nextTable: ParsedTable = {
      header: { cells: [{ content: "A" }, { content: "B" }] },
      alignments: ["none", "none"],
      rows: [{ cells: [{ content: "3" }, { content: "4" }] }],
    };
    const newWidget = new TableWidget(nextTable, "| A | B |\n|---|---|\n| 3 | 4 |", 12, {});

    const result = newWidget.updateDOM(dom, makeStubView(), oldWidget);
    const newObserver = ResizeObserverStub.instances.at(-1);

    expect(result).toBe(true);
    expect(oldObserver?.disconnect).toHaveBeenCalledTimes(1);
    expect(newObserver).toBeDefined();
    expect(newObserver).not.toBe(oldObserver);
    expect(newObserver?.observe).toHaveBeenCalledWith(dom);
    expect(dom.dataset.tableFrom).toBe("12");
    expect(dom.dataset.sourceFrom).toBe("12");
    expect(dom.querySelector("tbody td")?.textContent).toBe("3");
  });

  it("cancels a pending resize frame when updateDOM reuses the widget DOM", () => {
    ResizeObserverStub.instances.length = 0;
    const requestAnimationFrameSpy = vi.spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => 7);
    const cancelAnimationFrameSpy = vi.spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => {});

    try {
      const { view } = makeMeasureAwareView();
      const oldWidget = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
      const dom = oldWidget.toDOM(view);
      const oldObserver = ResizeObserverStub.instances.at(-1);
      oldObserver?.trigger();
      oldObserver?.trigger();

      const nextTable: ParsedTable = {
        header: { cells: [{ content: "A" }, { content: "B" }] },
        alignments: ["none", "none"],
        rows: [{ cells: [{ content: "3" }, { content: "4" }] }],
      };
      const newWidget = new TableWidget(nextTable, "| A | B |\n|---|---|\n| 3 | 4 |", 12, {});
      newWidget.updateDOM(dom, view, oldWidget);

      expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(7);
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });
});

describe("table-widget blur ownership", () => {
  function makeEditor(cell: HTMLElement) {
    return {
      controller: {
        view: {} as EditorView,
        setReadOnly: vi.fn(),
        setCallbacks: vi.fn(),
        destroy: vi.fn(),
      },
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

  it("eq returns true for empty macro sets", () => {
    const widgetA = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
    const widgetB = new TableWidget(makeTable(), "| A |\n|---|\n| 1 |", 0, {});
    expect(widgetA.eq(widgetB)).toBe(true);
  });
});

describe("tableDecorationField commit rebuild (#404)", () => {
  // Regression: after editing a cell and blurring, clicking back into the
  // same cell showed pre-edit content. The root cause was that the "commit"
  // dispatch had docChanged === false (the doc was already synced by live
  // keystrokes), so the StateField skipped rebuilding and the old widget
  // with stale ParsedTable persisted.

  const TABLE_DOC = "| A | B |\n| --- | --- |\n| 1 | 2 |";

  function createTableState(doc: string): EditorState {
    return createEditorState(doc, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        frontmatterField,
        editorFocusField,
        mathMacrosField,
        tableDecorationField,
      ],
    });
  }

  function getWidgetCount(state: EditorState): number {
    return getDecorationSpecs(state.field(tableDecorationField)).filter(
      (s) => s.widgetClass === "TableWidget",
    ).length;
  }

  it("rebuilds decorations on commit annotation even without docChanged", () => {
    const state = createTableState(TABLE_DOC);
    expect(getWidgetCount(state)).toBe(1);

    // Step 1: simulate a live keystroke edit — change "1" to "1X".
    // cellEditAnnotation("edit") causes the StateField to map (not rebuild).
    const editFrom = TABLE_DOC.indexOf("1");
    const afterEdit = state.update({
      changes: { from: editFrom, to: editFrom + 1, insert: "1X" },
      annotations: cellEditAnnotation.of("edit"),
    }).state;

    // After the edit the doc has "1X" but the widget's tableText is stale
    // (mapped, not rebuilt), so it still contains the old "| 1 | 2 |".
    const specsAfterEdit = getDecorationSpecs(afterEdit.field(tableDecorationField));
    expect(specsAfterEdit).toHaveLength(1);

    // Step 2: simulate commit (blur) — no doc change, just the annotation.
    // Before fix: skipped rebuilding because docChanged === false.
    // After fix: cellEdit === "commit" triggers full rebuild.
    const afterCommit = afterEdit.update({
      annotations: cellEditAnnotation.of("commit"),
    }).state;

    const specsAfterCommit = getDecorationSpecs(afterCommit.field(tableDecorationField));
    expect(specsAfterCommit).toHaveLength(1);

    // The rebuilt decoration should cover the correct range for "1X".
    // After the edit, "1" became "1X", so the table text is one char longer.
    const updatedTableText = "| A | B |\n| --- | --- |\n| 1X | 2 |";
    expect(specsAfterCommit[0].to - specsAfterCommit[0].from).toBe(updatedTableText.length);
  });

  it("rebuilds on annotation-only commit when doc is already up to date (#404 reopen)", () => {
    // This is the exact reopen scenario: live "edit" keystrokes already synced
    // the document, so the "commit" dispatch carries NO doc change — just the
    // annotation. The StateField must still rebuild so the new widget has a
    // fresh ParsedTable. Without this, clicking back into the cell would show
    // pre-edit text because the old widget's getRawCellText reads stale data.
    const state = createTableState(TABLE_DOC);

    // Step 1: live edit changes "1" to "1X" in the document.
    const editFrom = TABLE_DOC.indexOf("1");
    const afterEdit = state.update({
      changes: { from: editFrom, to: editFrom + 1, insert: "1X" },
      annotations: cellEditAnnotation.of("edit"),
    }).state;

    // Grab the stale widget reference from the mapped decoration set.
    const staleDecoIter = afterEdit.field(tableDecorationField).iter();
    expect(staleDecoIter.value).not.toBeNull();
    const staleWidget = staleDecoIter.value!.spec.widget;

    // Step 2: commit with NO doc change — just the annotation.
    // This is what syncToRoot now dispatches when newText === currentText.
    const afterCommit = afterEdit.update({
      annotations: cellEditAnnotation.of("commit"),
    }).state;

    // The StateField must have rebuilt (not just mapped).
    const freshDecoIter = afterCommit.field(tableDecorationField).iter();
    expect(freshDecoIter.value).not.toBeNull();
    const freshWidget = freshDecoIter.value!.spec.widget;

    // The rebuilt widget must be a different object — CM6 calls eq() against
    // the old one. Since tableText differs (old was mapped, new is from doc),
    // eq() returns false, and CM6 calls toDOM() on the new widget.
    expect(freshWidget).not.toBe(staleWidget);
  });

  it("maps decorations on edit annotation (live typing preserved)", () => {
    const state = createTableState(TABLE_DOC);
    const specsBefore = getDecorationSpecs(state.field(tableDecorationField));
    expect(specsBefore).toHaveLength(1);

    // Dispatch a doc change with "edit" annotation — should map, not rebuild.
    // The widget survives (same identity) so the inline editor is not destroyed.
    const editFrom = TABLE_DOC.indexOf("1");
    const afterEdit = state.update({
      changes: { from: editFrom, to: editFrom + 1, insert: "1X" },
      annotations: cellEditAnnotation.of("edit"),
    }).state;

    const specsAfter = getDecorationSpecs(afterEdit.field(tableDecorationField));
    expect(specsAfter).toHaveLength(1);

    // The mapped decoration's range shifts to accommodate the insertion but the
    // widget object is the same (mapped through, not rebuilt). Verify the
    // range was adjusted by the +1 char insertion.
    expect(specsAfter[0].to).toBe(specsBefore[0].to + 1);
  });
});
