import { type EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownLanguageExtensions } from "../editor/base-editor-extensions";
import { createTestView } from "../test-utils";
import { findCellBounds, tableDiscoveryField } from "./table-discovery";
import { tableKeybindings } from "./table-navigation";

const SIMPLE_DOC = [
  "| A   | B   |",
  "| --- | --- |",
  "| 1   | 2   |",
].join("\n");

const SIMPLE_DOC_WITH_NEW_ROW = [
  "| A   | B   |",
  "| --- | --- |",
  "| 1   | 2   |",
  "|     |     |",
].join("\n");

const TWO_ROW_DOC = [
  "| A   | B   |",
  "| --- | --- |",
  "| 1   | 22  |",
  "| 333 | 4   |",
].join("\n");

const TWO_ROW_DOC_WITH_NEW_ROW = [
  "| A   | B   |",
  "| --- | --- |",
  "| 1   | 22  |",
  "| 333 | 4   |",
  "|     |     |",
].join("\n");

const ARROW_DOC = [
  "| A     | B     |",
  "| ----- | ----- |",
  "| left  | right |",
  "| three | four  |",
].join("\n");

const VERTICAL_DOC = [
  "| A     | header |",
  "| ----- | ------ |",
  "| one   | abcde  |",
  "| two   | xy     |",
].join("\n");

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function makeView(doc: string): EditorView {
  return createTestView(doc, {
    extensions: [
      ...createMarkdownLanguageExtensions(),
      tableDiscoveryField,
      tableKeybindings,
    ],
  });
}

function getCell(view: EditorView, lineNumber: number, colIndex: number): { from: number; to: number } {
  const line = view.state.doc.line(lineNumber);
  const bounds = findCellBounds(line.text, line.from, colIndex);
  expect(bounds).not.toBeNull();
  if (!bounds) {
    throw new Error(`expected table cell at line ${lineNumber}, column ${colIndex}`);
  }
  return bounds;
}

function setCursor(view: EditorView, pos: number, head = pos): void {
  view.dispatch({
    selection: { anchor: pos, head },
    scrollIntoView: false,
  });
}

function pressKey(
  view: EditorView,
  key: string,
  eventInit: KeyboardEventInit = {},
): boolean {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...eventInit,
    }),
    "editor",
  );
}

describe("tableKeybindings", () => {
  it("tabs to the next cell and appends a row after the last cell", () => {
    view = makeView(SIMPLE_DOC);

    const firstCell = getCell(view, 3, 0);
    setCursor(view, firstCell.from + 1);
    expect(pressKey(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe(SIMPLE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from);

    const lastCell = getCell(view, 3, 1);
    setCursor(view, lastCell.from + 1);
    expect(pressKey(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe(SIMPLE_DOC_WITH_NEW_ROW);
    expect(view.state.selection.main.head).toBe(getCell(view, 4, 0).from);
  });

  it("shift-tabs backward across row boundaries without mutating the table", () => {
    view = makeView(SIMPLE_DOC);

    const firstBodyCell = getCell(view, 3, 0);
    setCursor(view, firstBodyCell.from);
    expect(pressKey(view, "Tab", { shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(SIMPLE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 1, 1).from);
  });

  it("enters to the next row in the same column and appends at the end", () => {
    view = makeView(TWO_ROW_DOC);

    const firstRowSecondCell = getCell(view, 3, 1);
    setCursor(view, firstRowSecondCell.from + 1);
    expect(pressKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe(TWO_ROW_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 4, 1).from);

    const lastRowSecondCell = getCell(view, 4, 1);
    setCursor(view, lastRowSecondCell.from);
    expect(pressKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe(TWO_ROW_DOC_WITH_NEW_ROW);
    expect(view.state.selection.main.head).toBe(getCell(view, 5, 1).from);
  });

  it("moves left only from cell boundaries and wraps to the previous row", () => {
    view = makeView(ARROW_DOC);

    const middleCell = getCell(view, 4, 1);
    setCursor(view, middleCell.from + 1);
    expect(pressKey(view, "ArrowLeft")).toBe(false);
    expect(view.state.selection.main.head).toBe(middleCell.from + 1);

    const firstCellOnRow = getCell(view, 4, 0);
    setCursor(view, firstCellOnRow.from);
    expect(pressKey(view, "ArrowLeft")).toBe(true);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).to);
  });

  it("moves right only from cell boundaries and wraps to the next row", () => {
    view = makeView(ARROW_DOC);

    const middleCell = getCell(view, 3, 0);
    setCursor(view, middleCell.from + 1);
    expect(pressKey(view, "ArrowRight")).toBe(false);
    expect(view.state.selection.main.head).toBe(middleCell.from + 1);

    const lastCellOnRow = getCell(view, 3, 1);
    setCursor(view, lastCellOnRow.to);
    expect(pressKey(view, "ArrowRight")).toBe(true);
    expect(view.state.selection.main.head).toBe(getCell(view, 4, 0).from);
  });

  it("preserves vertical intra-cell offsets and clamps to shorter targets", () => {
    view = makeView(VERTICAL_DOC);

    const headerCell = getCell(view, 1, 1);
    setCursor(view, headerCell.from + 4);
    expect(pressKey(view, "ArrowDown")).toBe(true);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from + 4);

    const longBodyCell = getCell(view, 3, 1);
    setCursor(view, longBodyCell.from + 4);
    expect(pressKey(view, "ArrowDown")).toBe(true);
    expect(view.state.selection.main.head).toBe(getCell(view, 4, 1).to);

    const shortBodyCell = getCell(view, 4, 1);
    setCursor(view, shortBodyCell.from + 1);
    expect(pressKey(view, "ArrowUp")).toBe(true);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from + 1);
  });

  it("guards backspace only at protected cell starts with an empty selection", () => {
    view = makeView(ARROW_DOC);

    const cell = getCell(view, 3, 1);
    setCursor(view, cell.from);
    expect(pressKey(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe(ARROW_DOC);

    setCursor(view, cell.from + 1);
    expect(pressKey(view, "Backspace")).toBe(false);

    setCursor(view, cell.from, cell.from + 1);
    expect(pressKey(view, "Backspace")).toBe(false);
  });

  it("guards delete only at protected cell ends with an empty selection", () => {
    view = makeView(ARROW_DOC);

    const cell = getCell(view, 3, 0);
    setCursor(view, cell.to);
    expect(pressKey(view, "Delete")).toBe(true);
    expect(view.state.doc.toString()).toBe(ARROW_DOC);

    setCursor(view, cell.from + 1);
    expect(pressKey(view, "Delete")).toBe(false);

    setCursor(view, cell.from, cell.from + 1);
    expect(pressKey(view, "Delete")).toBe(false);
  });
});
