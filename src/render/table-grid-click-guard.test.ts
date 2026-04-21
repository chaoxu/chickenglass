import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { createMarkdownLanguageExtensions } from "../editor/base-editor-extensions";
import { createTestView } from "../test-utils";
import { tableGridExtension } from "./table-grid";
import { guardTableGridMousePosition } from "./table-grid-click-guard";

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
  vi.restoreAllMocks();
  view?.destroy();
  view = undefined;
});

function makeView(): EditorView {
  return createTestView(DOC, {
    extensions: [...createMarkdownLanguageExtensions(), tableGridExtension],
  });
}

function findGridCell(target: EditorView, lineNumber: number, col: number): HTMLElement {
  for (const cell of target.dom.querySelectorAll<HTMLElement>(".cf-grid-cell")) {
    const pos = target.posAtDOM(cell, 0);
    const line = target.state.doc.lineAt(pos);
    if (line.number === lineNumber && Number(cell.dataset.col) === col) {
      return cell;
    }
  }
  throw new Error(`expected grid cell at line ${lineNumber}, col ${col}`);
}

function mouseDownOn(target: HTMLElement): MouseEvent {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 12,
    clientY: 34,
  });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("guardTableGridMousePosition", () => {
  it("returns the clicked cell end when browser coordinates resolve to another row", () => {
    view = makeView();
    const cell = findGridCell(view, 4, 1);
    const line = view.state.doc.line(4);
    const wrongLine = view.state.doc.line(5);
    const cellEnd = line.from + line.text.indexOf("2") + 1;
    const wrongRowPos = wrongLine.from + wrongLine.text.indexOf("4");
    vi.spyOn(view, "posAtCoords").mockReturnValue(wrongRowPos);

    const event = mouseDownOn(cell);

    expect(guardTableGridMousePosition(view, event)).toBe(cellEnd);
  });

  it("returns null when coordinates already resolve inside the clicked cell", () => {
    view = makeView();
    const cell = findGridCell(view, 4, 1);
    const line = view.state.doc.line(4);
    const cellPos = line.from + line.text.indexOf("2");
    vi.spyOn(view, "posAtCoords").mockReturnValue(cellPos);

    const event = mouseDownOn(cell);

    expect(guardTableGridMousePosition(view, event)).toBeNull();
  });
});
