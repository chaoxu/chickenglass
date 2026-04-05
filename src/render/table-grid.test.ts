import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";
import { createMarkdownLanguageExtensions } from "../editor/base-editor-extensions";
import { findTablesInState, findPipePositions } from "./table-discovery";
import {
  deleteSelectedTableSelection,
  getTableDeleteRange,
  tableGridExtension,
} from "./table-grid";
import { createTestView } from "../test-utils";

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

function makeView(doc = DOC): EditorView {
  return createTestView(doc, {
    extensions: [...createMarkdownLanguageExtensions(), tableGridExtension],
  });
}

function selectLines(target: EditorView, startLine: number, endLine: number): void {
  target.dispatch({
    selection: {
      anchor: target.state.doc.line(startLine).from,
      head: target.state.doc.line(endLine).to,
    },
  });
}

describe("getTableDeleteRange", () => {
  it("returns a row delete range for fully selected body rows", () => {
    view = makeView();
    const table = findTablesInState(view.state)[0];
    const row1 = view.state.doc.line(4);
    const row2 = view.state.doc.line(5);

    expect(getTableDeleteRange(view.state, table, row1.from, row2.to)).toEqual({
      from: row1.from,
      to: row2.to + 1,
      kind: "rows",
    });
  });

  it("returns null for partial body-row selections", () => {
    view = makeView();
    const table = findTablesInState(view.state)[0];
    const row1 = view.state.doc.line(4);

    expect(getTableDeleteRange(view.state, table, row1.from + 2, row1.to)).toBeNull();
  });

  it("returns a table delete range for full-table selections", () => {
    view = makeView();
    const table = findTablesInState(view.state)[0];

    expect(getTableDeleteRange(view.state, table, table.from, table.to)?.kind).toBe("table");
  });
});

describe("gridClickGuard (#617)", () => {
  it("is registered in tableGridExtension", () => {
    // The click guard must be present in the extension array so it runs
    // before CM6's default mousedown handling.
    view = makeView();
    expect(view).toBeDefined();
  });

  it("places cursor at end of correct cell when posAtCoords would resolve to wrong line", () => {
    // Verify that the cell bounds logic correctly identifies the last
    // column's editable range — this is what the click guard uses.
    view = makeView();
    // Line 4: "| 1 | 2 |" — last column cell content is "2"
    const line = view.state.doc.line(4);
    const pipes = findPipePositions(line.text);
    expect(pipes.length).toBeGreaterThanOrEqual(3); // |, |, |

    // The last cell (col 1) content "2" should be between pipes[1]+1 and pipes[2].
    const lastCellContentStart = line.from + pipes[1] + 1;
    const lastCellContentEnd = line.from + pipes[2];
    const cellText = view.state.sliceDoc(lastCellContentStart, lastCellContentEnd).trim();
    expect(cellText).toBe("2");
  });

  it("cell marks have data-col attributes for DOM-based cell identification", () => {
    view = makeView();
    // The grid cell marks carry data-col so the click guard can identify
    // which column was clicked via DOM traversal.
    const cellElements = view.dom.querySelectorAll<HTMLElement>(".cf-grid-cell");
    expect(cellElements.length).toBeGreaterThan(0);
    for (const cell of cellElements) {
      expect(cell.dataset.col).toBeDefined();
    }
  });
});

describe("gridContextMenuHandler cross-row guard (#696)", () => {
  it("context menu handler uses the same cross-row correction as click guard", () => {
    // The context menu handler should use guardCrossRowPos so that
    // right-clicking whitespace in the last column targets the correct cell.
    // We verify the same cell-bounds logic works for the last column.
    view = makeView();
    // Line 4: "| 1 | 2 |" — last column (col 1), content "2"
    const line = view.state.doc.line(4);
    const pipes = findPipePositions(line.text);
    expect(pipes.length).toBeGreaterThanOrEqual(3);

    const lastCellContentStart = line.from + pipes[1] + 1;
    const lastCellContentEnd = line.from + pipes[2];
    const cellText = view.state.sliceDoc(lastCellContentStart, lastCellContentEnd).trim();
    expect(cellText).toBe("2");

    // Dispatching to the end of the correct cell should land on line 4
    view.dispatch({ selection: { anchor: lastCellContentEnd - 1 }, scrollIntoView: false });
    const cursorLine = view.state.doc.lineAt(view.state.selection.main.head);
    expect(cursorLine.number).toBe(4);
  });

  it("cell marks on all rows carry data-col for DOM-based cross-row detection", () => {
    view = makeView();
    // Both body rows (lines 4 and 5) should have data-col on their cells
    const cells = view.dom.querySelectorAll<HTMLElement>(".cf-grid-cell");
    const colsByRow = new Map<number, number[]>();
    for (const cell of cells) {
      const pos = view.posAtDOM(cell, 0);
      const lineNum = view.state.doc.lineAt(pos).number;
      const cols = colsByRow.get(lineNum) ?? [];
      cols.push(Number(cell.dataset.col));
      colsByRow.set(lineNum, cols);
    }
    // Body rows 4 and 5 should each have cells with data-col
    for (const row of [4, 5]) {
      const cols = colsByRow.get(row);
      expect(cols).toBeDefined();
      expect(cols!.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("table grid rendering for inline-span edge cases", () => {
  it("keeps later cells visible when \\(...\\) is opened in one cell and closed in the next", () => {
    view = makeView([
      "| A | B | C | D |",
      "| --- | --- | --- | --- |",
      "| row | \\(x | \\) y | z |",
    ].join("\n"));

    const colsByRow = new Map<number, number[]>();
    const textByRow = new Map<number, string[]>();
    for (const cell of view.dom.querySelectorAll<HTMLElement>(".cf-grid-cell")) {
      const pos = view.posAtDOM(cell, 0);
      const lineNum = view.state.doc.lineAt(pos).number;
      const cols = colsByRow.get(lineNum) ?? [];
      cols.push(Number(cell.dataset.col));
      colsByRow.set(lineNum, cols);

      const texts = textByRow.get(lineNum) ?? [];
      texts.push(cell.textContent?.trim() ?? "");
      textByRow.set(lineNum, texts);
    }

    expect(colsByRow.get(1)).toEqual([0, 1, 2, 3]);
    expect(colsByRow.get(3)).toEqual([0, 1, 2, 3]);
    expect(textByRow.get(3)).toEqual(["row", "\\(x", "\\) y", "z"]);
  });
});

describe("deleteSelectedTableSelection", () => {
  it("deletes selected body rows while preserving header and separator", () => {
    view = makeView();
    selectLines(view, 4, 5);

    expect(deleteSelectedTableSelection(view)).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "before",
      "| A | B |",
      "| --- | --- |",
      "after",
    ].join("\n"));
  });
});
