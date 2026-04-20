import { describe, expect, it } from "vitest";

import {
  applyStringEditorDocumentChanges,
  createMinimalEditorDocumentChanges,
} from "./editor-doc-change";

describe("neutral editor document changes", () => {
  it("applies string document changes from end to start", () => {
    expect(
      applyStringEditorDocumentChanges("abcdef", [
        { from: 1, to: 3, insert: "XX" },
        { from: 4, to: 6, insert: "YY" },
      ]),
    ).toBe("aXXdYY");
  });

  it("creates a minimal single-span diff", () => {
    expect(createMinimalEditorDocumentChanges("hello world", "hello brave world")).toEqual([
      { from: 6, to: 6, insert: "brave " },
    ]);
  });
});
