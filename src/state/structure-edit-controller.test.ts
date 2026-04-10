import { describe, expect, it } from "vitest";
import {
  activateStructureEdit,
  deactivateStructureEdit,
  deactivateStructureEditIfMatch,
} from "./structure-edit-controller";
import { STRUCTURE_EDIT_IDLE, structureEditActive } from "./structure-edit";

describe("activateStructureEdit", () => {
  it("transitions from idle to editing", () => {
    const result = activateStructureEdit(STRUCTURE_EDIT_IDLE, "key-1", "table");
    expect(result).toEqual({ status: "editing", blockKey: "key-1", variant: "table" });
  });

  it("returns same reference when already editing the same block", () => {
    const current = structureEditActive("key-1", "table");
    const result = activateStructureEdit(current, "key-1", "table");
    expect(result).toBe(current);
  });

  it("transitions to a different block", () => {
    const current = structureEditActive("key-1", "table");
    const result = activateStructureEdit(current, "key-2", "display-math");
    expect(result).toEqual({ status: "editing", blockKey: "key-2", variant: "display-math" });
  });
});

describe("deactivateStructureEdit", () => {
  it("transitions from editing to idle", () => {
    const current = structureEditActive("key-1", "table");
    const result = deactivateStructureEdit(current);
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });

  it("returns same reference when already idle", () => {
    const result = deactivateStructureEdit(STRUCTURE_EDIT_IDLE);
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });
});

describe("deactivateStructureEditIfMatch", () => {
  it("deactivates when block key matches", () => {
    const current = structureEditActive("key-1", "table");
    const result = deactivateStructureEditIfMatch(current, "key-1");
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });

  it("does not deactivate when block key differs", () => {
    const current = structureEditActive("key-1", "table");
    const result = deactivateStructureEditIfMatch(current, "key-2");
    expect(result).toBe(current);
  });

  it("returns same reference when idle", () => {
    const result = deactivateStructureEditIfMatch(STRUCTURE_EDIT_IDLE, "key-1");
    expect(result).toBe(STRUCTURE_EDIT_IDLE);
  });
});
