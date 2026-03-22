import { describe, expect, it } from "vitest";
import {
  findCellBounds,
  findClosestTable,
  findPipePositions,
  findTableAtCursor,
  skipSeparator,
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

describe("findPipePositions", () => {
  it("ignores escaped pipes", () => {
    expect(findPipePositions("| a \\| b | c |")).toEqual([0, 9, 13]);
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
});
