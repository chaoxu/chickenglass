import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../parser";
import {
  findCellBounds,
  findClosestTable,
  findPipePositions,
  findTableAtCursor,
  findTablesInState,
  findTablesInView,
  skipSeparator,
  tableDiscoveryField,
  type TableRange,
} from "./table-discovery";
import type { ParsedTable } from "./table-utils";

const parsed: ParsedTable = {
  header: { cells: [{ content: "A" }, { content: "B" }] },
  alignments: ["none", "none"],
  rows: [{ cells: [{ content: "1" }, { content: "2" }] }],
};

function table(from: number, to: number): TableRange {
  return {
    from,
    to,
    separatorFrom: from + 10,
    separatorTo: from + 20,
    parsed,
    lines: ["| A | B |", "| --- | --- |", "| 1 | 2 |"],
    startLineNumber: 1,
  };
}

function makeDiscoveryState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      tableDiscoveryField,
    ],
  });
}

describe("findPipePositions", () => {
  it("ignores escaped pipes", () => {
    expect(findPipePositions("| a \\| b | c |")).toEqual([0, 9, 13]);
  });

  it("ignores pipes inside $…$ math spans", () => {
    expect(findPipePositions("| $O(r \\cdot |E| \\cdot T)$ | No |")).toEqual([0, 27, 32]);
  });

  it("treats a trailing extra $ as literal so the next cell stays separate", () => {
    expect(findPipePositions("| $a$$ | $b$ |")).toEqual([0, 7, 13]);
  });

  it("does not let trailing $ match opening $ in the next cell", () => {
    expect(findPipePositions("| Quicksort | $O(n \\log n)$$ | $O(\\log n)$ |"))
      .toEqual([0, 12, 29, 43]);
  });

  it("ignores escaped pipes inside \\(…\\) math spans", () => {
    expect(findPipePositions("| \\(a \\| b\\) | No |")).toEqual([0, 13, 18]);
  });

  it("does not let \\(...\\) match across a real cell separator", () => {
    expect(findPipePositions("| row | \\(x | \\) y | z |")).toEqual([0, 6, 12, 19, 23]);
  });

  it("does not let \\(...\\) match across a no-space cell separator", () => {
    expect(findPipePositions("| row | \\(x|\\) y | z |")).toEqual([0, 6, 11, 17, 21]);
  });

  it("does not let \\(...\\) match across a separator when the next cell contains text before \\)", () => {
    expect(findPipePositions("| row | \\(x | text \\) y | z |")).toEqual([0, 6, 12, 24, 28]);
  });

  it("ignores pipes inside single-backtick code spans", () => {
    expect(findPipePositions("| `a | b` | c |")).toEqual([0, 10, 14]);
  });

  it("ignores pipes inside double-backtick code spans", () => {
    expect(findPipePositions("| ``a | b`` | c |")).toEqual([0, 12, 16]);
  });

  it("keeps separators visible after an unmatched $", () => {
    expect(findPipePositions("| $a | c |")).toEqual([0, 5, 9]);
  });

  it("keeps separators visible after an unmatched \\(", () => {
    expect(findPipePositions("| \\(a | c |")).toEqual([0, 6, 10]);
  });

  it("does not treat $$ as an inline span that hides separators", () => {
    expect(findPipePositions("| $$ | c |")).toEqual([0, 5, 9]);
  });

  it("keeps separators visible after an unmatched backtick", () => {
    expect(findPipePositions("| `a | c |")).toEqual([0, 5, 9]);
  });
});

describe("findCellBounds", () => {
  it("returns trimmed bounds within the requested cell", () => {
    const bounds = findCellBounds("|  alpha  | beta |", 100, 0);
    expect(bounds).toEqual({ from: 103, to: 108 });
  });
});

describe("table range helpers", () => {
  it("finds the table containing a cursor position", () => {
    const tables = [table(10, 40), table(60, 90)];
    expect(findTableAtCursor(tables, 20)?.from).toBe(10);
    expect(findTableAtCursor(tables, 75)?.from).toBe(60);
    expect(findTableAtCursor(tables, 50)).toBeNull();
  });

  it("finds the closest table by tracked position", () => {
    const tables = [table(10, 40), table(60, 90), table(140, 180)];
    expect(findClosestTable(tables, 70)?.from).toBe(60);
    expect(findClosestTable(tables, 120)?.from).toBe(140);
  });

  it("skips the separator row when requested", () => {
    expect(skipSeparator(1, 1)).toBe(2);
    expect(skipSeparator(1, -1)).toBe(0);
    expect(skipSeparator(3, -1)).toBe(3);
  });

  it("reuses the cached table discovery result across selection-only updates", () => {
    const state = makeDiscoveryState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n"));

    const initialTables = state.field(tableDiscoveryField);
    expect(findTablesInState(state)).toBe(initialTables);

    const movedState = state.update({ selection: { anchor: 5 } }).state;
    expect(movedState.field(tableDiscoveryField)).toBe(initialTables);

    const changedState = movedState.update({
      changes: { from: movedState.doc.length, insert: "\n| 3 | 4 |" },
    }).state;
    expect(changedState.field(tableDiscoveryField)).not.toBe(initialTables);
  });

  it("reuses the full cached result when a doc change happens after all tables", () => {
    const state = makeDiscoveryState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "after",
    ].join("\n"));

    const initialTables = state.field(tableDiscoveryField);
    const changedState = state.update({
      changes: { from: state.doc.length, insert: " more" },
    }).state;

    expect(changedState.field(tableDiscoveryField)).toBe(initialTables);
  });

  it("preserves untouched table objects when prose between tables changes", () => {
    const state = makeDiscoveryState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "between",
      "",
      "| C | D |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n"));

    const initialTables = state.field(tableDiscoveryField);
    const changedState = state.update({
      changes: { from: state.doc.line(5).to, insert: " prose" },
    }).state;
    const changedTables = changedState.field(tableDiscoveryField);

    expect(changedTables).not.toBe(initialTables);
    expect(changedTables[0]).toBe(initialTables[0]);
    expect(changedTables[1]).not.toBe(initialTables[1]);
    expect(changedTables[1].startLineNumber).toBe(initialTables[1].startLineNumber);
    expect(changedTables[1].from).toBeGreaterThan(initialTables[1].from);
  });

  it("rebuilds only the touched table when a cell edit stays within one table", () => {
    const state = makeDiscoveryState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n"));

    const initialTables = state.field(tableDiscoveryField);
    const changedState = state.update({
      changes: {
        from: state.doc.line(3).from + 2,
        to: state.doc.line(3).from + 3,
        insert: "9",
      },
    }).state;
    const changedTables = changedState.field(tableDiscoveryField);

    expect(changedTables[0]).not.toBe(initialTables[0]);
    expect(changedTables[0].lines[2]).toContain("9");
    expect(changedTables[1]).toBe(initialTables[1]);
  });

  it("drops only the invalidated table when its separator row stops parsing", () => {
    const state = makeDiscoveryState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n"));

    const initialTables = state.field(tableDiscoveryField);
    const separatorLine = state.doc.line(2);
    const changedState = state.update({
      changes: {
        from: separatorLine.from,
        to: separatorLine.to,
        insert: "| abc | def |",
      },
    }).state;
    const changedTables = changedState.field(tableDiscoveryField);

    expect(changedTables).toHaveLength(1);
    expect(changedTables[0]).toBe(initialTables[1]);
  });

  it("filters view tables from the cached state-level discovery", () => {
    const state = makeDiscoveryState([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n"));

    const tables = state.field(tableDiscoveryField);
    const visibleTables = findTablesInView({
      state,
      visibleRanges: [{ from: tables[1].from, to: tables[1].to }],
    } as unknown as import("@codemirror/view").EditorView);

    expect(visibleTables).toEqual([tables[1]]);
  });

});
