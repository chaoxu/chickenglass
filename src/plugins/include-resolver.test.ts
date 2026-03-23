import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../app/file-manager";
import {
  extractIncludePaths,
  resolveIncludePath,
  resolveIncludes,
  flattenIncludes,
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
