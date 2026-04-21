import { describe, expect, it } from "vitest";
import type { ParsedTable } from "./table-utils";
import {
  createTableNavigationModel,
  moveTableCellHorizontally,
  moveTableCellVertically,
  readTableCellAddress,
} from "./table-widget-navigation";

function makeTable(): ParsedTable {
  return {
    header: { cells: [{ content: "A" }, { content: "B" }] },
    alignments: ["none", "none"],
    rows: [
      { cells: [{ content: "1" }, { content: "2" }] },
      { cells: [{ content: "3" }, { content: "4" }] },
    ],
  };
}

describe("table widget navigation model", () => {
  it("hands off before the table when moving above the header row", () => {
    const model = createTableNavigationModel(makeTable());

    expect(
      moveTableCellVertically(model, { section: "header", row: 0, col: 0 }, "up"),
    ).toEqual({ kind: "handoff", direction: "before" });
  });

  it("hands off after the table when moving below the last body row", () => {
    const model = createTableNavigationModel(makeTable());

    expect(
      moveTableCellVertically(model, { section: "body", row: 1, col: 1 }, "down"),
    ).toEqual({ kind: "handoff", direction: "after" });
  });

  it("hands off at horizontal table edges after row wrapping is exhausted", () => {
    const model = createTableNavigationModel(makeTable());

    expect(
      moveTableCellHorizontally(model, { section: "header", row: 0, col: 0 }, "left"),
    ).toEqual({ kind: "handoff", direction: "before" });

    expect(
      moveTableCellHorizontally(model, { section: "body", row: 1, col: 1 }, "right"),
    ).toEqual({ kind: "handoff", direction: "after" });
  });

  it("wraps horizontal movement through rows before handing off", () => {
    const model = createTableNavigationModel(makeTable());

    expect(
      moveTableCellHorizontally(model, { section: "body", row: 0, col: 0 }, "left"),
    ).toEqual({
      kind: "cell",
      address: { section: "header", row: 0, col: 1 },
      placeAtEnd: true,
    });
    expect(
      moveTableCellHorizontally(model, { section: "header", row: 0, col: 1 }, "right"),
    ).toEqual({
      kind: "cell",
      address: { section: "body", row: 0, col: 0 },
      placeAtEnd: false,
    });
  });

  it("normalizes DOM cell addresses from dataset values", () => {
    const cell = document.createElement("td");
    cell.dataset.section = "body";
    cell.dataset.row = "2";
    cell.dataset.col = "3";

    expect(readTableCellAddress(cell)).toEqual({ section: "body", row: 2, col: 3 });
  });
});
