import { describe, expect, it } from "vitest";
import {
  addTableColumn,
  addTableRow,
  isTableDraftChanged,
  removeTableColumn,
  removeTableRow,
  updateTableBodyCell,
  updateTableHeaderCell,
  type TableDraft,
} from "./table-edit";

const baseDraft: TableDraft = {
  alignments: ["left", "right"],
  headers: ["Name", "Value"],
  rows: [
    ["alpha", "1"],
    ["beta", "2"],
  ],
};

describe("updateTableHeaderCell", () => {
  it("updates a header cell by column index", () => {
    const result = updateTableHeaderCell(baseDraft, 0, "Label");
    expect(result.headers).toEqual(["Label", "Value"]);
    expect(result.rows).toBe(baseDraft.rows);
  });
});

describe("updateTableBodyCell", () => {
  it("updates a body cell by row and column index", () => {
    const result = updateTableBodyCell(baseDraft, 1, 1, "99");
    expect(result.rows[1]).toEqual(["beta", "99"]);
    expect(result.rows[0]).toBe(baseDraft.rows[0]);
  });
});

describe("addTableRow", () => {
  it("appends an empty row", () => {
    const result = addTableRow(baseDraft);
    expect(result.rows.length).toBe(3);
    expect(result.rows[2]).toEqual(["", ""]);
  });
});

describe("removeTableRow", () => {
  it("removes a row by index", () => {
    const result = removeTableRow(baseDraft, 0);
    expect(result.rows).toEqual([["beta", "2"]]);
  });

  it("returns same draft for out-of-range index", () => {
    expect(removeTableRow(baseDraft, -1)).toBe(baseDraft);
    expect(removeTableRow(baseDraft, 5)).toBe(baseDraft);
  });
});

describe("addTableColumn", () => {
  it("appends an empty column", () => {
    const result = addTableColumn(baseDraft);
    expect(result.headers).toEqual(["Name", "Value", ""]);
    expect(result.alignments).toEqual(["left", "right", null]);
    expect(result.rows[0]).toEqual(["alpha", "1", ""]);
  });
});

describe("removeTableColumn", () => {
  it("removes a column by index", () => {
    const result = removeTableColumn(baseDraft, 0);
    expect(result.headers).toEqual(["Value"]);
    expect(result.rows[0]).toEqual(["1"]);
  });

  it("returns same draft for out-of-range index", () => {
    expect(removeTableColumn(baseDraft, -1)).toBe(baseDraft);
    expect(removeTableColumn(baseDraft, 5)).toBe(baseDraft);
  });
});

describe("isTableDraftChanged", () => {
  it("returns false for same reference", () => {
    expect(isTableDraftChanged(baseDraft, baseDraft)).toBe(false);
  });

  it("detects header changes", () => {
    const modified = updateTableHeaderCell(baseDraft, 0, "Changed");
    expect(isTableDraftChanged(baseDraft, modified)).toBe(true);
  });

  it("detects body cell changes", () => {
    const modified = updateTableBodyCell(baseDraft, 0, 0, "changed");
    expect(isTableDraftChanged(baseDraft, modified)).toBe(true);
  });

  it("detects row count changes", () => {
    const modified = addTableRow(baseDraft);
    expect(isTableDraftChanged(baseDraft, modified)).toBe(true);
  });
});
