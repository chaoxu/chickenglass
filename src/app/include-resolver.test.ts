import { describe, expect, it } from "vitest";

import type { FileSystem } from "./file-manager";
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
    expect(expanded.status).toBe("expanded");
    expect(expanded.failure).toBeNull();
    expect(expanded.sourceMap?.regions).toHaveLength(1);

    const [chapterRegion] = expanded.sourceMap?.regions ?? [];
    expect(chapterRegion?.file).toBe("chapter.md");
    expect(chapterRegion?.children).toHaveLength(1);
    expect(chapterRegion?.children[0]?.file).toBe("section.md");
  });

  it("returns an explicit failure when an include cycle is detected", async () => {
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
    expect(expanded.status).toBe("failed");
    expect(expanded.failure).toEqual({
      kind: "cycle",
      chain: ["main.md", "main.md"],
      message: "Include cycle detected: main.md -> main.md",
    });
  });

  it("returns an explicit failure for missing included files", async () => {
    const fs = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "::: {.include}",
        "missing.md",
        ":::",
      ].join("\n"),
    });

    const rawMain = await fs.readFile("main.md");
    const expanded = await expandDocumentIncludes("main.md", rawMain, fs);

    expect(expanded.text).toBe(rawMain);
    expect(expanded.sourceMap).toBeNull();
    expect(expanded.status).toBe("failed");
    expect(expanded.failure).toEqual({
      kind: "not-found",
      path: "missing.md",
      message: "Included file not found: missing.md",
    });
  });

  it("returns an explicit failure when an included file cannot be read", async () => {
    const fs: FileSystem = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "::: {.include}",
        "locked.md",
        ":::",
      ].join("\n"),
      "locked.md": "# Locked",
    });
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (path) => {
      if (path === "locked.md") {
        throw new Error("permission denied");
      }
      return readFile(path);
    };

    const rawMain = await fs.readFile("main.md");
    const expanded = await expandDocumentIncludes("main.md", rawMain, fs);

    expect(expanded.text).toBe(rawMain);
    expect(expanded.sourceMap).toBeNull();
    expect(expanded.status).toBe("failed");
    expect(expanded.failure).toEqual({
      kind: "unavailable",
      path: "locked.md",
      causeMessage: "permission denied",
      message: "Included file unavailable: locked.md: permission denied",
    });
  });

  it("does not turn unexpected resolver errors into a raw-document success", async () => {
    const fs: FileSystem = new MemoryFileSystem({
      "main.md": [
        "# Main",
        "",
        "::: {.include}",
        "bad.md",
        ":::",
      ].join("\n"),
      "bad.md": "# Bad",
    });
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (path) => {
      if (path === "bad.md") {
        return 42 as unknown as string;
      }
      return readFile(path);
    };

    const rawMain = await fs.readFile("main.md");

    await expect(expandDocumentIncludes("main.md", rawMain, fs)).rejects.toThrow(
      "Included file returned non-string content: bad.md",
    );
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
    expect(expanded.status).toBe("unchanged");
    expect(expanded.failure).toBeNull();
  });
});
