import { describe, expect, it } from "vitest";

import { buildProjectedWritePlan } from "./editor-session-write-plan";
import { ConflictingIncludeContentError, SourceMap } from "./source-map";

describe("buildProjectedWritePlan", () => {
  it("writes a plain document directly when no source map exists", () => {
    expect(buildProjectedWritePlan("main.md", "# Notes", null)).toEqual([
      { path: "main.md", content: "# Notes" },
    ]);
  });

  it("reconstructs the main file and writes included files separately", () => {
    const includeRef = [
      "::: {.include}",
      "chapter.md",
      ":::",
    ].join("\n");
    const header = "# Main\n\n";
    const footer = "\n\n# End";
    const doc = `${header}Chapter body\n${footer}`;
    const sourceMap = new SourceMap([{
      from: header.length,
      to: header.length + "Chapter body\n".length,
      file: "chapter.md",
      originalRef: includeRef,
      rawFrom: header.length,
      rawTo: header.length + includeRef.length,
    }]);

    expect(buildProjectedWritePlan("copy.md", doc, sourceMap)).toEqual([
      { path: "chapter.md", content: "Chapter body\n" },
      { path: "copy.md", content: `${header}${includeRef}${footer}` },
    ]);
  });

  it("throws when duplicate include regions for the same file diverge", () => {
    const sourceMap = new SourceMap([
      {
        from: 0,
        to: 3,
        file: "chapter.md",
        originalRef: "{{chapter}}",
        rawFrom: 0,
        rawTo: 11,
      },
      {
        from: 4,
        to: 7,
        file: "chapter.md",
        originalRef: "{{chapter}}",
        rawFrom: 12,
        rawTo: 23,
      },
    ]);

    expect(() => buildProjectedWritePlan("main.md", "abc\nxyz", sourceMap)).toThrow(
      ConflictingIncludeContentError,
    );
  });
});
