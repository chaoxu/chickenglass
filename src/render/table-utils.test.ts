import { describe, it, expect } from "vitest";
import {
  parseTable,
  formatTable,
  serializeTable,
  detectAlignment,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
} from "./table-utils";
import type { ParsedTable } from "./table-utils";

/** Helper that parses a table and asserts it is not null. */
function mustParse(lines: readonly string[]): ParsedTable {
  const result = parseTable(lines);
  expect(result).not.toBeNull();
  // After the assertion we know result is non-null
  return result as ParsedTable;
}

describe("detectAlignment", () => {
  it("detects none alignment from plain dashes", () => {
    expect(detectAlignment("| --- | --- |")).toEqual(["none", "none"]);
  });

  it("detects left alignment", () => {
    expect(detectAlignment("| :--- | --- |")).toEqual(["left", "none"]);
  });

  it("detects right alignment", () => {
    expect(detectAlignment("| --- | ---: |")).toEqual(["none", "right"]);
  });

  it("detects center alignment", () => {
    expect(detectAlignment("| :---: | --- |")).toEqual(["center", "none"]);
  });

  it("detects mixed alignments", () => {
    expect(detectAlignment("| :--- | :---: | ---: | --- |")).toEqual([
      "left",
      "center",
      "right",
      "none",
    ]);
  });
});

describe("parseTable", () => {
  it("parses a simple table", () => {
    const result = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    expect(result.header.cells).toEqual([
      { content: "A" },
      { content: "B" },
    ]);
    expect(result.alignments).toEqual(["none", "none"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cells).toEqual([
      { content: "1" },
      { content: "2" },
    ]);
  });

  it("returns null for non-table input", () => {
    expect(parseTable(["hello"])).toBeNull();
    expect(parseTable(["hello", "world"])).toBeNull();
  });

  it("parses table without leading/trailing pipes", () => {
    const result = mustParse(["A | B", "--- | ---", "1 | 2"]);
    expect(result.header.cells).toEqual([
      { content: "A" },
      { content: "B" },
    ]);
  });

  it("preserves inline markdown in cells", () => {
    const result = mustParse([
      "| Header | Math |",
      "| --- | --- |",
      "| **bold** | $x^2$ |",
    ]);
    expect(result.rows[0].cells[0].content).toBe("**bold**");
    expect(result.rows[0].cells[1].content).toBe("$x^2$");
  });

  it("pads rows with fewer cells than header", () => {
    const result = mustParse([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 |",
    ]);
    expect(result.rows[0].cells).toHaveLength(3);
    expect(result.rows[0].cells[1].content).toBe("");
    expect(result.rows[0].cells[2].content).toBe("");
  });

  it("handles escaped pipes in cells", () => {
    const result = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| a\\|b | c |",
    ]);
    expect(result.rows[0].cells[0].content).toBe("a\\|b");
  });
});

describe("formatTable", () => {
  it("formats columns to equal width", () => {
    const table = mustParse([
      "| A | Longer |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    const formatted = formatTable(table);
    // Column 0: max("A","1") = 1 char, min width 3 => padded to 3
    // Column 1: max("Longer","2") = 6 chars => padded to 6
    expect(formatted[0]).toBe("| A   | Longer |");
    expect(formatted[1]).toBe("| --- | ------ |");
    expect(formatted[2]).toBe("| 1   | 2      |");
  });

  it("respects alignment in separator", () => {
    const table = mustParse([
      "| Left | Center | Right |",
      "| :--- | :---: | ---: |",
      "| a | b | c |",
    ]);
    const formatted = formatTable(table);
    // Separator cells include alignment markers and are padded to column width
    expect(formatted[1]).toMatch(/:[-]+/);     // left-aligned col has leading colon
    expect(formatted[1]).toMatch(/:[-]+:/);    // center-aligned col has both colons
    expect(formatted[1]).toMatch(/[-]+:/);     // right-aligned col has trailing colon
  });
});

describe("serializeTable", () => {
  it("round-trips a parsed table", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    const serialized = serializeTable(table);
    expect(serialized).toEqual([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
  });

  it("preserves alignment markers in separator row", () => {
    const table = mustParse([
      "| Left | Center | Right | None |",
      "| :--- | :---: | ---: | --- |",
      "| a | b | c | d |",
    ]);
    const serialized = serializeTable(table);
    expect(serialized[1]).toBe("| :--- | :---: | ---: | --- |");
  });
});

describe("addRow", () => {
  it("adds an empty row at the end", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    const result = addRow(table);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].cells).toEqual([
      { content: "" },
      { content: "" },
    ]);
  });

  it("adds a row at a specific index", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
    ]);
    const result = addRow(table, 1);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1].cells[0].content).toBe("");
    expect(result.rows[2].cells[0].content).toBe("3");
  });
});

describe("deleteRow", () => {
  it("removes a row by index", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
    ]);
    const result = deleteRow(table, 0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cells[0].content).toBe("3");
  });

  it("returns unchanged table for out-of-bounds index", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    const result = deleteRow(table, 5);
    expect(result.rows).toHaveLength(1);
  });
});

describe("addColumn", () => {
  it("adds a column at the end", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    const result = addColumn(table);
    expect(result.header.cells).toHaveLength(3);
    expect(result.alignments).toHaveLength(3);
    expect(result.rows[0].cells).toHaveLength(3);
    expect(result.rows[0].cells[2].content).toBe("");
  });

  it("adds a column at a specific index", () => {
    const table = mustParse([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ]);
    const result = addColumn(table, 1);
    expect(result.header.cells[1].content).toBe("");
    expect(result.header.cells[2].content).toBe("B");
  });
});

describe("deleteColumn", () => {
  it("removes a column by index", () => {
    const table = mustParse([
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 | 3 |",
    ]);
    const result = deleteColumn(table, 1);
    expect(result.header.cells).toHaveLength(2);
    expect(result.header.cells[0].content).toBe("A");
    expect(result.header.cells[1].content).toBe("C");
    expect(result.rows[0].cells[0].content).toBe("1");
    expect(result.rows[0].cells[1].content).toBe("3");
  });

  it("does not delete the last column", () => {
    const table = mustParse([
      "| A |",
      "| --- |",
      "| 1 |",
    ]);
    const result = deleteColumn(table, 0);
    expect(result.header.cells).toHaveLength(1);
  });
});
