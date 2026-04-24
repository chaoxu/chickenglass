import { describe, expect, it } from "vitest";
import { createExternalConflictMergeDocument } from "./external-conflict-merge";

describe("createExternalConflictMergeDocument", () => {
  it("uses disk content when local content did not change from base", () => {
    expect(createExternalConflictMergeDocument({
      base: "base",
      local: "base",
      disk: "disk",
    })).toEqual({
      content: "disk",
      hasConflictMarkers: false,
    });
  });

  it("uses local content when disk content did not change from base", () => {
    expect(createExternalConflictMergeDocument({
      base: "base",
      local: "local",
      disk: "base",
    })).toEqual({
      content: "local",
      hasConflictMarkers: false,
    });
  });

  it("keeps both versions with conflict markers when both sides changed", () => {
    expect(createExternalConflictMergeDocument({
      base: "base\n",
      local: "local\n",
      disk: "disk\n",
    })).toEqual({
      content: [
        "<<<<<<< Local edits\n",
        "local\n",
        "||||||| Last saved\n",
        "base\n",
        "=======\n",
        "disk\n",
        ">>>>>>> Disk version\n",
      ].join(""),
      hasConflictMarkers: true,
    });
  });
});
