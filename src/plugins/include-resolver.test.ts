import { describe, expect, it, vi } from "vitest";

import { MemoryFileSystem } from "../app/file-manager";
import {
  IncludeExpansionCache,
  extractIncludePaths,
  resolveIncludePath,
  resolveIncludes,
  resolveIncludesFromContent,
  flattenIncludes,
  flattenIncludesWithSourceMap,
  collectIncludedPaths,
  IncludeCycleError,
  IncludeNotFoundError,
} from "./include-resolver";

describe("extractIncludePaths", () => {
  it("extracts a single include path", () => {
    const content = `::: {.include}
chapter1.md
:::`;
    expect(extractIncludePaths(content)).toEqual(["chapter1.md"]);
  });

  it("extracts multiple include paths", () => {
    const content = `# Main

::: {.include}
chapter1.md
:::

Some text in between.

::: {.include}
chapter2.md
:::`;
    expect(extractIncludePaths(content)).toEqual([
      "chapter1.md",
      "chapter2.md",
    ]);
  });

  it("handles paths with directories", () => {
    const content = `::: {.include}
chapters/intro.md
:::`;
    expect(extractIncludePaths(content)).toEqual(["chapters/intro.md"]);
  });

  it("trims whitespace from paths", () => {
    const content = `::: {.include}
  chapter1.md
:::`;
    expect(extractIncludePaths(content)).toEqual(["chapter1.md"]);
  });

  it("returns empty array when no includes found", () => {
    const content = `# Just a heading

Some regular text.

::: {.theorem}
A theorem block.
:::`;
    expect(extractIncludePaths(content)).toEqual([]);
  });

  it("handles single-line include syntax", () => {
    const content = `::: {.include} chapter1.md :::`;
    expect(extractIncludePaths(content)).toEqual(["chapter1.md"]);
  });

  // Regression: #357 — include syntax inside fenced code blocks must be ignored
  it("ignores include syntax inside a fenced code block (backticks)", () => {
    const content = `\`\`\`
::: {.include}
foo.md
:::
\`\`\``;
    expect(extractIncludePaths(content)).toEqual([]);
  });

  it("ignores include syntax inside a fenced code block (tildes)", () => {
    const content = `~~~
::: {.include}
foo.md
:::
~~~`;
    expect(extractIncludePaths(content)).toEqual([]);
  });

  it("extracts includes outside code blocks while ignoring those inside", () => {
    const content = `::: {.include}
real.md
:::

\`\`\`
::: {.include}
fake.md
:::
\`\`\`

::: {.include}
also-real.md
:::`;
    expect(extractIncludePaths(content)).toEqual(["real.md", "also-real.md"]);
  });

  it("ignores include inside a code block with info string", () => {
    const content = `\`\`\`markdown
::: {.include}
example.md
:::
\`\`\``;
    expect(extractIncludePaths(content)).toEqual([]);
  });

  // Lezer tree walking: code blocks are parsed as FencedCode, not FencedDiv,
  // so include-like syntax inside them is naturally invisible to the tree walker.
  it("ignores include inside indented code-like content within a code block", () => {
    const content = `\`\`\`\`
Some explanation:

\`\`\`
::: {.include}
nested.md
:::
\`\`\`
\`\`\`\``;
    expect(extractIncludePaths(content)).toEqual([]);
  });
});

describe("resolveIncludePath", () => {
  it("resolves relative paths from the same directory", () => {
    expect(resolveIncludePath("main.md", "chapter1.md")).toBe("chapter1.md");
  });

  it("resolves relative paths from a subdirectory", () => {
    expect(resolveIncludePath("chapters/main.md", "intro.md")).toBe(
      "chapters/intro.md",
    );
  });

  it("resolves paths with parent directory references", () => {
    expect(resolveIncludePath("chapters/main.md", "../appendix.md")).toBe(
      "appendix.md",
    );
  });

  it("resolves absolute paths by stripping leading slash", () => {
    expect(resolveIncludePath("chapters/main.md", "/root-file.md")).toBe(
      "root-file.md",
    );
  });

  it("normalizes paths with dot segments", () => {
    expect(resolveIncludePath("a/b/c.md", "./d.md")).toBe("a/b/d.md");
  });
});

describe("resolveIncludes", () => {
  it("resolves a single include", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.include}
chapter1.md
:::`,
      "chapter1.md": "# Chapter 1\n\nContent here.",
    });

    const includes = await resolveIncludes("main.md", fs);
    expect(includes).toHaveLength(1);
    expect(includes[0].path).toBe("chapter1.md");
    expect(includes[0].content).toBe("# Chapter 1\n\nContent here.");
    expect(includes[0].children).toHaveLength(0);
  });

  it("resolves nested includes (A includes B includes C)", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.include}
chapter1.md
:::`,
      "chapter1.md": `# Chapter 1

::: {.include}
section1.md
:::`,
      "section1.md": "## Section 1\n\nNested content.",
    });

    const includes = await resolveIncludes("main.md", fs);
    expect(includes).toHaveLength(1);
    expect(includes[0].path).toBe("chapter1.md");
    expect(includes[0].children).toHaveLength(1);
    expect(includes[0].children[0].path).toBe("section1.md");
    expect(includes[0].children[0].content).toBe(
      "## Section 1\n\nNested content.",
    );
  });

  it("resolves multiple includes at the same level", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.include}
ch1.md
:::

::: {.include}
ch2.md
:::`,
      "ch1.md": "Chapter 1",
      "ch2.md": "Chapter 2",
    });

    const includes = await resolveIncludes("main.md", fs);
    expect(includes).toHaveLength(2);
    expect(includes[0].path).toBe("ch1.md");
    expect(includes[1].path).toBe("ch2.md");
  });

  it("throws IncludeCycleError on direct cycle", async () => {
    const fs = new MemoryFileSystem({
      "a.md": `::: {.include}
b.md
:::`,
      "b.md": `::: {.include}
a.md
:::`,
    });

    await expect(resolveIncludes("a.md", fs)).rejects.toThrow(
      IncludeCycleError,
    );
    await expect(resolveIncludes("a.md", fs)).rejects.toThrow(
      /Include cycle detected/,
    );
  });

  it("throws IncludeCycleError on self-referential include (A -> A)", async () => {
    const fs = new MemoryFileSystem({
      "a.md": `::: {.include}
a.md
:::`,
    });

    await expect(resolveIncludes("a.md", fs)).rejects.toThrow(
      IncludeCycleError,
    );
    await expect(resolveIncludes("a.md", fs)).rejects.toThrow(
      /Include cycle detected/,
    );
  });

  it("normalizes the root path before cycle detection", async () => {
    const reads: string[] = [];
    const memory = new MemoryFileSystem({
      "./a.md": `::: {.include}
a.md
:::`,
      "a.md": `::: {.include}
a.md
:::`,
    });
    const fs = {
      listTree: () => memory.listTree(),
      readFile: async (path: string) => {
        reads.push(path);
        return memory.readFile(path);
      },
      writeFile: (path: string, content: string) => memory.writeFile(path, content),
      createFile: (path: string, content?: string) => memory.createFile(path, content),
      exists: (path: string) => memory.exists(path),
      renameFile: (oldPath: string, newPath: string) => memory.renameFile(oldPath, newPath),
      createDirectory: (path: string) => memory.createDirectory(path),
      deleteFile: (path: string) => memory.deleteFile(path),
      writeFileBinary: (path: string, data: Uint8Array) => memory.writeFileBinary(path, data),
      readFileBinary: (path: string) => memory.readFileBinary(path),
    };

    await expect(resolveIncludes("./a.md", fs)).rejects.toThrow(
      IncludeCycleError,
    );
    expect(reads).toEqual(["a.md"]);
  });

  it("throws IncludeCycleError on indirect cycle (A -> B -> C -> A)", async () => {
    const fs = new MemoryFileSystem({
      "a.md": `::: {.include}
b.md
:::`,
      "b.md": `::: {.include}
c.md
:::`,
      "c.md": `::: {.include}
a.md
:::`,
    });

    await expect(resolveIncludes("a.md", fs)).rejects.toThrow(
      IncludeCycleError,
    );
  });

  it("throws IncludeNotFoundError for missing files", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.include}
missing.md
:::`,
    });

    await expect(resolveIncludes("main.md", fs)).rejects.toThrow(
      IncludeNotFoundError,
    );
    await expect(resolveIncludes("main.md", fs)).rejects.toThrow(
      /Included file not found: missing\.md/,
    );
  });

  it("resolves includes with relative paths from subdirectories", async () => {
    const fs = new MemoryFileSystem({
      "book/main.md": `::: {.include}
chapters/ch1.md
:::`,
      "book/chapters/ch1.md": "Chapter content",
    });

    const includes = await resolveIncludes("book/main.md", fs);
    expect(includes).toHaveLength(1);
    expect(includes[0].path).toBe("book/chapters/ch1.md");
  });

  // Regression: #357 — include inside code block must not trigger file read
  it("does not resolve includes inside fenced code blocks", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `\`\`\`
::: {.include}
missing.md
:::
\`\`\``,
    });

    // missing.md does not exist — if the code-block guard fails,
    // this would throw IncludeNotFoundError.
    const includes = await resolveIncludes("main.md", fs);
    expect(includes).toHaveLength(0);
  });
});

describe("resolveIncludesFromContent", () => {
  it("resolves includes from provided content without reading root from disk", async () => {
    const fs = new MemoryFileSystem({
      "root.md": "disk content (should not be used)",
      "chapter1.md": "# Chapter 1",
    });
    const inMemoryContent = `::: {.include}
chapter1.md
:::`;
    const includes = await resolveIncludesFromContent("root.md", inMemoryContent, fs);
    expect(includes).toHaveLength(1);
    expect(includes[0].path).toBe("chapter1.md");
    expect(includes[0].content).toBe("# Chapter 1");
  });

  it("recursively resolves nested includes from disk", async () => {
    const fs = new MemoryFileSystem({
      "chapter1.md": `# Chapter 1

::: {.include}
section1.md
:::`,
      "section1.md": "## Section 1\n\nNested content.",
    });
    const rootContent = `::: {.include}
chapter1.md
:::`;
    const includes = await resolveIncludesFromContent("main.md", rootContent, fs);
    expect(includes[0].children).toHaveLength(1);
    expect(includes[0].children[0].path).toBe("section1.md");
    expect(includes[0].children[0].content).toBe("## Section 1\n\nNested content.");
  });

  it("detects cycles between in-memory content and disk files", async () => {
    const fs = new MemoryFileSystem({
      "b.md": `::: {.include}\na.md\n:::`,
      "a.md": "should not matter",
    });
    const rootContent = `::: {.include}\nb.md\n:::`;
    await expect(resolveIncludesFromContent("a.md", rootContent, fs)).rejects.toThrow(IncludeCycleError);
  });

  it("throws IncludeNotFoundError for missing nested file", async () => {
    const fs = new MemoryFileSystem({
      "chapter1.md": `::: {.include}\nmissing.md\n:::`,
    });
    const rootContent = `::: {.include}\nchapter1.md\n:::`;
    await expect(resolveIncludesFromContent("main.md", rootContent, fs)).rejects.toThrow(IncludeNotFoundError);
  });

  it("resolves three-level deep nesting", async () => {
    const fs = new MemoryFileSystem({
      "a.md": `::: {.include}\nb.md\n:::`,
      "b.md": `::: {.include}\nc.md\n:::`,
      "c.md": "leaf content",
    });
    const includes = await resolveIncludesFromContent("root.md", `::: {.include}\na.md\n:::`, fs);
    expect(includes[0].children[0].children[0].path).toBe("c.md");
    expect(includes[0].children[0].children[0].content).toBe("leaf content");
  });

  it("returns empty array when content has no includes", async () => {
    const fs = new MemoryFileSystem({});
    const includes = await resolveIncludesFromContent("main.md", "# Just text", fs);
    expect(includes).toEqual([]);
  });

  it("throws generic error when file exists but readFile fails (e.g. EACCES)", async () => {
    const memory = new MemoryFileSystem({
      "chapter.md": "content that should not be returned",
    });
    const fs = {
      listTree: () => memory.listTree(),
      readFile: async (path: string) => {
        if (path === "chapter.md") throw new Error("EACCES: permission denied");
        return memory.readFile(path);
      },
      writeFile: (p: string, c: string) => memory.writeFile(p, c),
      createFile: (p: string, c?: string) => memory.createFile(p, c),
      exists: (p: string) => memory.exists(p),
      renameFile: (o: string, n: string) => memory.renameFile(o, n),
      createDirectory: (p: string) => memory.createDirectory(p),
      deleteFile: (p: string) => memory.deleteFile(p),
      writeFileBinary: (p: string, d: Uint8Array) => memory.writeFileBinary(p, d),
      readFileBinary: (p: string) => memory.readFileBinary(p),
    };
    const rootContent = `::: {.include}\nchapter.md\n:::`;
    await expect(
      resolveIncludesFromContent("main.md", rootContent, fs),
    ).rejects.toThrow("EACCES");
  });
});

describe("flattenIncludesWithSourceMap", () => {
  it("produces nested child regions for recursive includes", () => {
    const sectionInclude = `::: {.include}
sec.md
:::`;
    const chapterContent = `Chapter text\n${sectionInclude}\nMore chapter`;
    const rootContent = `::: {.include}
ch.md
:::`;

    const includes = [{
      path: "ch.md",
      content: chapterContent,
      children: [{ path: "sec.md", content: "Section text", children: [] }],
    }];

    const result = flattenIncludesWithSourceMap(rootContent, includes);

    // One top-level region for ch.md with one child for sec.md
    expect(result.regions).toHaveLength(1);
    const chRegion = result.regions[0];
    expect(chRegion.file).toBe("ch.md");
    expect(chRegion.children).toHaveLength(1);

    const secRegion = chRegion.children[0];
    expect(secRegion.file).toBe("sec.md");
    expect(result.text.substring(secRegion.from, secRegion.to)).toBe("Section text");

    // Full expanded text contains all content, no include directives
    expect(result.text).toContain("Chapter text");
    expect(result.text).toContain("Section text");
    expect(result.text).toContain("More chapter");
    expect(result.text).not.toContain("{.include}");
  });

  it("nested regions have rawFrom/rawTo relative to parent content", () => {
    const sectionInclude = `::: {.include}
sec.md
:::`;
    const chapterContent = `Prefix\n${sectionInclude}\nSuffix`;

    const includes = [{
      path: "ch.md",
      content: chapterContent,
      children: [{ path: "sec.md", content: "Nested", children: [] }],
    }];

    const result = flattenIncludesWithSourceMap(`::: {.include}\nch.md\n:::`, includes);
    const secRegion = result.regions[0].children[0];

    // rawFrom/rawTo relative to parent file's content (chapterContent)
    const expectedRawFrom = chapterContent.indexOf(sectionInclude);
    const expectedRawTo = expectedRawFrom + sectionInclude.length;
    expect(secRegion.rawFrom).toBe(expectedRawFrom);
    expect(secRegion.rawTo).toBe(expectedRawTo);
  });
});

describe("flattenIncludes", () => {
  it("returns root content when no includes", () => {
    const result = flattenIncludes("# Hello\n\nWorld", []);
    expect(result).toBe("# Hello\n\nWorld");
  });

  it("replaces include blocks with file content", () => {
    const rootContent = `# Main

::: {.include}
ch1.md
:::

End.`;

    const includes = [
      {
        path: "ch1.md",
        content: "## Chapter 1\n\nSome content.",
        children: [],
      },
    ];

    const result = flattenIncludes(rootContent, includes);
    expect(result).toContain("# Main");
    expect(result).toContain("## Chapter 1");
    expect(result).toContain("Some content.");
    expect(result).toContain("End.");
    expect(result).not.toContain("{.include}");
  });

  it("handles nested includes recursively", () => {
    const rootContent = `::: {.include}
ch1.md
:::`;

    const includes = [
      {
        path: "ch1.md",
        content: `Chapter 1

::: {.include}
sec1.md
:::`,
        children: [
          {
            path: "sec1.md",
            content: "Section 1 content",
            children: [],
          },
        ],
      },
    ];

    const result = flattenIncludes(rootContent, includes);
    expect(result).toContain("Chapter 1");
    expect(result).toContain("Section 1 content");
    expect(result).not.toContain("{.include}");
  });

  // Regression: #357 — code-block include patterns preserved verbatim
  it("does not replace include syntax inside a fenced code block", () => {
    const rootContent = `\`\`\`
::: {.include}
example.md
:::
\`\`\``;

    const result = flattenIncludes(rootContent, []);
    expect(result).toBe(rootContent);
  });
});

describe("collectIncludedPaths", () => {
  it("returns empty array for no includes", () => {
    expect(collectIncludedPaths([])).toEqual([]);
  });

  it("collects paths from flat includes", () => {
    const includes = [
      { path: "ch1.md", content: "", children: [] },
      { path: "ch2.md", content: "", children: [] },
    ];
    expect(collectIncludedPaths(includes)).toEqual(["ch1.md", "ch2.md"]);
  });

  it("collects paths from nested includes depth-first", () => {
    const includes = [
      {
        path: "ch1.md",
        content: "",
        children: [{ path: "sec1.md", content: "", children: [] }],
      },
      { path: "ch2.md", content: "", children: [] },
    ];
    expect(collectIncludedPaths(includes)).toEqual([
      "ch1.md",
      "sec1.md",
      "ch2.md",
    ]);
  });
});

describe("IncludeExpansionCache", () => {
  const rootContent = `::: {.include}\nch1.md\n:::`;

  function makeFs(files: Record<string, string>) {
    return new MemoryFileSystem(files);
  }

  it("returns null on empty cache", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    expect(await cache.get("main.md", rootContent, fs)).toBeNull();
  });

  it("returns cached result when nothing changed", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    const includes = [{ path: "ch1.md", content: "Chapter 1", children: [] }];
    const result = { text: "Chapter 1", regions: [] };
    cache.set("main.md", rootContent, includes, result);

    const hit = await cache.get("main.md", rootContent, fs);
    expect(hit).toEqual(result);
  });

  it("misses when root content changes", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    const includes = [{ path: "ch1.md", content: "Chapter 1", children: [] }];
    cache.set("main.md", rootContent, includes, { text: "Chapter 1", regions: [] });

    const newRoot = `::: {.include}\nch2.md\n:::`;
    expect(await cache.get("main.md", newRoot, fs)).toBeNull();
  });

  it("misses when an included file changes on disk", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    const includes = [{ path: "ch1.md", content: "Chapter 1", children: [] }];
    cache.set("main.md", rootContent, includes, { text: "Chapter 1", regions: [] });

    // Modify the included file on disk
    await fs.writeFile("ch1.md", "Chapter 1 — revised");
    expect(await cache.get("main.md", rootContent, fs)).toBeNull();
  });

  it("misses when an included file is deleted", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    const includes = [{ path: "ch1.md", content: "Chapter 1", children: [] }];
    cache.set("main.md", rootContent, includes, { text: "Chapter 1", regions: [] });

    await fs.deleteFile("ch1.md");
    expect(await cache.get("main.md", rootContent, fs)).toBeNull();
  });

  it("validates nested include files", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1 text", "sec1.md": "Section 1" });
    const includes = [{
      path: "ch1.md",
      content: "Chapter 1 text",
      children: [{ path: "sec1.md", content: "Section 1", children: [] }],
    }];
    const result = { text: "expanded", regions: [] };
    cache.set("main.md", rootContent, includes, result);

    // Nested file unchanged → hit
    expect(await cache.get("main.md", rootContent, fs)).toEqual(result);

    // Modify nested file → miss
    await fs.writeFile("sec1.md", "Section 1 — revised");
    expect(await cache.get("main.md", rootContent, fs)).toBeNull();
  });

  it("clear removes all entries", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    const includes = [{ path: "ch1.md", content: "Chapter 1", children: [] }];
    cache.set("main.md", rootContent, includes, { text: "Chapter 1", regions: [] });

    cache.clear();
    expect(await cache.get("main.md", rootContent, fs)).toBeNull();
  });

  it("skips file reads on root content mismatch (fast reject)", async () => {
    const cache = new IncludeExpansionCache();
    const fs = makeFs({ "ch1.md": "Chapter 1" });
    const readSpy = vi.spyOn(fs, "readFile");
    const includes = [{ path: "ch1.md", content: "Chapter 1", children: [] }];
    cache.set("main.md", rootContent, includes, { text: "Chapter 1", regions: [] });

    await cache.get("main.md", "different content", fs);
    expect(readSpy).not.toHaveBeenCalled();
  });
});
