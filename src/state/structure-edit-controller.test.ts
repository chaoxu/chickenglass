import { describe, expect, it } from "vitest";
import {
  activateStructureEdit,
  deactivateStructureEdit,
  deactivateStructureEditIfMatch,
} from "./structure-edit-controller";
import { STRUCTURE_EDIT_IDLE, structureEditActive } from "./structure-edit";

describe("activateStructureEdit", () => {
  it("transitions from idle to editing", () => {
    const result = activateStructureEdit(
      STRUCTURE_EDIT_IDLE,
      "key-1",
      "table",
      "table-cell",
    );
    expect(result).toEqual({
      status: "editing",
      blockKey: "key-1",
      variant: "table",
      surface: "table-cell",
    });
  });

  it("returns same reference when already editing the same surface", () => {
    const current = structureEditActive("key-1", "table", "table-cell");
    const result = activateStructureEdit(current, "key-1", "table", "table-cell");
    expect(result).toBe(current);
  });

  it("transitions to a different block", () => {
    const current = structureEditActive("key-1", "table", "table-cell");
    const result = activateStructureEdit(
      current,
      "key-2",
      "display-math",
      "display-math-source",
    );
    expect(result).toEqual({
      status: "editing",
      blockKey: "key-2",
      variant: "display-math",
      surface: "display-math-source",
    });
  });

  it("switches surfaces within the same block", () => {
    const current = structureEditActive("key-1", "fenced-div", "block-opener");
    const result = activateStructureEdit(current, "key-1", "fenced-div", "embed-url");
    expect(result).toEqual({
      status: "editing",
      blockKey: "key-1",
      variant: "fenced-div",
      surface: "embed-url",
    });
  });
});

describe("deactivateStructureEdit", () => {
  it("transitions from editing to idle", () => {
    const current = structureEditActive("key-1", "table", "table-cell");
    const result = deactivateStructureEdit(current);
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });

  it("returns same reference when already idle", () => {
    const result = deactivateStructureEdit(STRUCTURE_EDIT_IDLE);
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });
});

describe("deactivateStructureEditIfMatch", () => {
  it("deactivates when block key and surface match", () => {
    const current = structureEditActive("key-1", "table", "table-cell");
    const result = deactivateStructureEditIfMatch(current, "key-1", "table-cell");
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });

  it("does not deactivate when block key differs", () => {
    const current = structureEditActive("key-1", "table", "table-cell");
    const result = deactivateStructureEditIfMatch(current, "key-2", "table-cell");
    expect(result).toBe(current);
  });

  it("does not deactivate when the surface differs", () => {
    const current = structureEditActive("key-1", "fenced-div", "embed-url");
    const result = deactivateStructureEditIfMatch(current, "key-1", "block-opener");
    expect(result).toBe(current);
  });

  it("returns same reference when idle", () => {
    const result = deactivateStructureEditIfMatch(
      STRUCTURE_EDIT_IDLE,
      "key-1",
      "table-cell",
    );
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });
});
