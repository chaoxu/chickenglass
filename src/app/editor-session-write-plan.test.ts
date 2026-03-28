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
      children: [],
    }]);

    expect(buildProjectedWritePlan("copy.md", doc, sourceMap)).toEqual([
      { path: "chapter.md", content: "Chapter body\n" },
      { path: "copy.md", content: `${header}${includeRef}${footer}` },
    ]);
  });

  it("writes nested included files back to their own paths", () => {
    const chapterRef = "::: {.include}\nchapter.md\n:::";
    const sectionRef = "::: {.include}\nsection.md\n:::";

    // Expanded: "HEADER|ch-text|sec-text|ch-tail|FOOTER"
    const header = "HEADER|";
    const chText = "ch-text|";
    const secText = "sec-text|";
    const chTail = "ch-tail|";
    const footer = "FOOTER";
    const doc = header + chText + secText + chTail + footer;

    const chFrom = header.length;
    const secFrom = chFrom + chText.length;
    const secTo = secFrom + secText.length;
    const chTo = secTo + chTail.length;

    const sourceMap = new SourceMap([{
      from: chFrom, to: chTo,
      file: "chapter.md", originalRef: chapterRef,
      rawFrom: chFrom, rawTo: chFrom + chapterRef.length,
      children: [{
        from: secFrom, to: secTo,
        file: "section.md", originalRef: sectionRef,
        rawFrom: chText.length, rawTo: chText.length + sectionRef.length,
        children: [],
      }],
    }]);

    const writes = buildProjectedWritePlan("main.md", doc, sourceMap);
    expect(writes.find((w) => w.path === "section.md")?.content).toBe(secText);
    expect(writes.find((w) => w.path === "chapter.md")?.content).toBe(chText + sectionRef + chTail);
    expect(writes.find((w) => w.path === "main.md")?.content).toBe(header + chapterRef + footer);
  });

  it("throws when duplicate include regions for the same file diverge", () => {
    const sourceMap = new SourceMap([
      {
        from: 0, to: 3, file: "chapter.md",
        originalRef: "{{chapter}}", rawFrom: 0, rawTo: 11, children: [],
      },
      {
        from: 4, to: 7, file: "chapter.md",
        originalRef: "{{chapter}}", rawFrom: 12, rawTo: 23, children: [],
      },
    ]);

    expect(() => buildProjectedWritePlan("main.md", "abc\nxyz", sourceMap)).toThrow(
      ConflictingIncludeContentError,
    );
  });
});
