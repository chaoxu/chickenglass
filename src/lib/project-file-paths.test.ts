import { describe, expect, it } from "vitest";

import { projectFilePath } from "./project-file-paths";

describe("projectFilePath", () => {
  it("preserves filesystem command paths without markdown normalization", () => {
    expect(projectFilePath("docs/../main.md")).toBe("docs/../main.md");
    expect(projectFilePath("/absolute-looking.md")).toBe("/absolute-looking.md");
  });
});
