import { delimiter } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPandocResourcePath } from "./export-latex.mjs";

describe("export-latex CLI profile", () => {
  it("matches desktop export resource-path semantics", () => {
    expect(buildPandocResourcePath("/project/notes", "/project")).toBe(
      ["/project/notes", "/project"].join(delimiter),
    );
    expect(buildPandocResourcePath("/project", "/project")).toBe("/project");
  });
});
