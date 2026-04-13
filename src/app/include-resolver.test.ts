import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "./file-manager";
import { expandDocumentIncludes } from "./include-resolver";

describe("expandDocumentIncludes", () => {
  it("flattens nested include blocks into a composed document with source-map regions", async () => {
    const fs = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "::: {.include}",
        "chapter.md",
        ":::",
        "",
        "# End",
      ].join("\n"),
      "chapter.md": [
        "# Chapter",
        "",
        "Prelude",
        "",
        "::: {.include}",
        "section.md",
        ":::",
        "",
        "Coda",
      ].join("\n"),
      "section.md": "## Section\n\nBody.\n",
    });

    const rawMain = await fs.readFile("main.md");
    const expanded = await expandDocumentIncludes("main.md", rawMain, fs);

    expect(expanded.text).toContain("# Chapter");
    expect(expanded.text).toContain("## Section");
    expect(expanded.text).not.toContain("chapter.md");
    expect(expanded.sourceMap?.regions).toHaveLength(1);

    const [chapterRegion] = expanded.sourceMap?.regions ?? [];
    expect(chapterRegion?.file).toBe("chapter.md");
    expect(chapterRegion?.children).toHaveLength(1);
    expect(chapterRegion?.children[0]?.file).toBe("section.md");
  });

  it("falls back to raw content when an include cycle is detected", async () => {
    const fs = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "::: {.include}",
        "main.md",
        ":::",
      ].join("\n"),
    });

    const rawMain = await fs.readFile("main.md");
    const expanded = await expandDocumentIncludes("main.md", rawMain, fs);

    expect(expanded.text).toBe(rawMain);
    expect(expanded.sourceMap).toBeNull();
  });

  it("ignores include syntax embedded in fenced code blocks", async () => {
    const fs = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "```md",
        "::: {.include}",
        "chapter.md",
        ":::",
        "```",
      ].join("\n"),
      "chapter.md": "# Chapter",
    });

    const rawMain = await fs.readFile("main.md");
    const expanded = await expandDocumentIncludes("main.md", rawMain, fs);

    expect(expanded.text).toBe(rawMain);
    expect(expanded.sourceMap).toBeNull();
  });
});
