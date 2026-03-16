import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../app/file-manager";
import {
  extractNumberedBlocks,
  buildRefMap,
  processIncludes,
  isIncludeError,
  isNumberedClass,
  type BlockCounters,
} from "./include-plugin";

describe("isNumberedClass", () => {
  it("returns true for standard numbered classes", () => {
    expect(isNumberedClass("theorem")).toBe(true);
    expect(isNumberedClass("lemma")).toBe(true);
    expect(isNumberedClass("definition")).toBe(true);
    expect(isNumberedClass("proposition")).toBe(true);
    expect(isNumberedClass("corollary")).toBe(true);
    expect(isNumberedClass("example")).toBe(true);
    expect(isNumberedClass("remark")).toBe(true);
  });

  it("returns false for non-numbered classes", () => {
    expect(isNumberedClass("proof")).toBe(false);
    expect(isNumberedClass("include")).toBe(false);
    expect(isNumberedClass("note")).toBe(false);
  });
});

describe("extractNumberedBlocks", () => {
  it("extracts a single numbered block", () => {
    const content = `::: {.theorem #thm:main}
Statement of the theorem.
:::`;
    const counters: BlockCounters = new Map();
    const blocks = extractNumberedBlocks(content, counters);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockClass).toBe("theorem");
    expect(blocks[0].id).toBe("thm:main");
    expect(blocks[0].number).toBe(1);
  });

  it("numbers blocks of the same class sequentially", () => {
    const content = `::: {.theorem #thm:first}
First theorem.
:::

::: {.theorem #thm:second}
Second theorem.
:::`;
    const counters: BlockCounters = new Map();
    const blocks = extractNumberedBlocks(content, counters);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].number).toBe(1);
    expect(blocks[1].number).toBe(2);
  });

  it("numbers different classes independently", () => {
    const content = `::: {.theorem #thm:one}
A theorem.
:::

::: {.lemma #lem:one}
A lemma.
:::

::: {.theorem #thm:two}
Another theorem.
:::`;
    const counters: BlockCounters = new Map();
    const blocks = extractNumberedBlocks(content, counters);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      blockClass: "theorem",
      id: "thm:one",
      number: 1,
    });
    expect(blocks[1]).toEqual({
      blockClass: "lemma",
      id: "lem:one",
      number: 1,
    });
    expect(blocks[2]).toEqual({
      blockClass: "theorem",
      id: "thm:two",
      number: 2,
    });
  });

  it("continues numbering from existing counters", () => {
    const counters: BlockCounters = new Map([["theorem", 3]]);
    const content = `::: {.theorem #thm:next}
Next theorem.
:::`;
    const blocks = extractNumberedBlocks(content, counters);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].number).toBe(4);
    expect(counters.get("theorem")).toBe(4);
  });

  it("skips non-numbered classes", () => {
    const content = `::: {.proof}
Proof content.
:::

::: {.theorem #thm:one}
A theorem.
:::`;
    const counters: BlockCounters = new Map();
    const blocks = extractNumberedBlocks(content, counters);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockClass).toBe("theorem");
  });

  it("handles blocks without ids", () => {
    const content = `::: {.theorem}
An unnamed theorem.
:::`;
    const counters: BlockCounters = new Map();
    const blocks = extractNumberedBlocks(content, counters);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBeUndefined();
    expect(blocks[0].number).toBe(1);
  });
});

describe("buildRefMap", () => {
  it("builds reference targets from numbered blocks", () => {
    const blocks = [
      { blockClass: "theorem", id: "thm:main", number: 1 },
      { blockClass: "lemma", id: "lem:key", number: 2 },
    ];

    const targets = buildRefMap(blocks, "main.md");
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({
      id: "thm:main",
      label: "Theorem 1",
      sourcePath: "main.md",
    });
    expect(targets[1]).toEqual({
      id: "lem:key",
      label: "Lemma 2",
      sourcePath: "main.md",
    });
  });

  it("skips blocks without ids", () => {
    const blocks = [
      { blockClass: "theorem", id: undefined, number: 1 },
      { blockClass: "theorem", id: "thm:two", number: 2 },
    ];

    const targets = buildRefMap(blocks, "main.md");
    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe("thm:two");
  });
});

describe("processIncludes", () => {
  it("processes a document with no includes", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `# Main

::: {.theorem #thm:one}
A theorem.
:::`,
    });

    const result = await processIncludes("main.md", await fs.readFile("main.md"), fs);
    expect(isIncludeError(result)).toBe(false);
    if (isIncludeError(result)) return;

    expect(result.mergedContent).toContain("# Main");
    expect(result.numberedBlocks).toHaveLength(1);
    expect(result.numberedBlocks[0].number).toBe(1);
    expect(result.includedPaths).toHaveLength(0);
  });

  it("merges included files with continuous numbering", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.theorem #thm:main}
Main theorem.
:::

::: {.include}
chapter1.md
:::`,
      "chapter1.md": `::: {.theorem #thm:ch1}
Chapter 1 theorem.
:::`,
    });

    const result = await processIncludes(
      "main.md",
      await fs.readFile("main.md"),
      fs,
    );
    expect(isIncludeError(result)).toBe(false);
    if (isIncludeError(result)) return;

    expect(result.mergedContent).toContain("Main theorem.");
    expect(result.mergedContent).toContain("Chapter 1 theorem.");
    expect(result.numberedBlocks).toHaveLength(2);
    expect(result.numberedBlocks[0].number).toBe(1);
    expect(result.numberedBlocks[1].number).toBe(2);
  });

  it("resolves cross-references across included files", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.theorem #thm:main}
Main theorem.
:::

::: {.include}
chapter1.md
:::`,
      "chapter1.md": `::: {.lemma #lem:ch1}
A lemma in chapter 1.
:::`,
    });

    const result = await processIncludes(
      "main.md",
      await fs.readFile("main.md"),
      fs,
    );
    expect(isIncludeError(result)).toBe(false);
    if (isIncludeError(result)) return;

    expect(result.refMap.get("thm:main")).toEqual({
      id: "thm:main",
      label: "Theorem 1",
      sourcePath: "main.md",
    });
    expect(result.refMap.get("lem:ch1")).toEqual({
      id: "lem:ch1",
      label: "Lemma 1",
      sourcePath: "chapter1.md",
    });
  });

  it("handles nested includes with continuous numbering", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.theorem #thm:main}
Main theorem.
:::

::: {.include}
ch1.md
:::`,
      "ch1.md": `::: {.theorem #thm:ch1}
Chapter 1 theorem.
:::

::: {.include}
sec1.md
:::`,
      "sec1.md": `::: {.theorem #thm:sec1}
Section 1 theorem.
:::`,
    });

    const result = await processIncludes(
      "main.md",
      await fs.readFile("main.md"),
      fs,
    );
    expect(isIncludeError(result)).toBe(false);
    if (isIncludeError(result)) return;

    // After merging: main has theorem 1, ch1 has theorem 2, sec1 has theorem 3
    expect(result.numberedBlocks).toHaveLength(3);
    expect(result.numberedBlocks[0].number).toBe(1);
    expect(result.numberedBlocks[1].number).toBe(2);
    expect(result.numberedBlocks[2].number).toBe(3);

    // Cross-refs work across all files
    expect(result.refMap.get("thm:main")?.label).toBe("Theorem 1");
    expect(result.refMap.get("thm:ch1")?.label).toBe("Theorem 2");
    expect(result.refMap.get("thm:sec1")?.label).toBe("Theorem 3");
  });

  it("returns cycle error for cyclic includes", async () => {
    const fs = new MemoryFileSystem({
      "a.md": `::: {.include}
b.md
:::`,
      "b.md": `::: {.include}
a.md
:::`,
    });

    const result = await processIncludes("a.md", await fs.readFile("a.md"), fs);
    expect(isIncludeError(result)).toBe(true);
    if (!isIncludeError(result)) return;

    expect(result.type).toBe("cycle");
    expect(result.message).toContain("cycle");
  });

  it("returns not-found error for missing included files", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.include}
missing.md
:::`,
    });

    const result = await processIncludes(
      "main.md",
      await fs.readFile("main.md"),
      fs,
    );
    expect(isIncludeError(result)).toBe(true);
    if (!isIncludeError(result)) return;

    expect(result.type).toBe("not-found");
    expect(result.message).toContain("missing.md");
  });

  it("handles multiple includes at the same level", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.include}
ch1.md
:::

::: {.include}
ch2.md
:::`,
      "ch1.md": `::: {.theorem #thm:ch1}
Theorem in ch1.
:::`,
      "ch2.md": `::: {.theorem #thm:ch2}
Theorem in ch2.
:::`,
    });

    const result = await processIncludes(
      "main.md",
      await fs.readFile("main.md"),
      fs,
    );
    expect(isIncludeError(result)).toBe(false);
    if (isIncludeError(result)) return;

    expect(result.numberedBlocks).toHaveLength(2);
    expect(result.numberedBlocks[0].number).toBe(1);
    expect(result.numberedBlocks[1].number).toBe(2);
    expect(result.includedPaths).toEqual(["ch1.md", "ch2.md"]);
  });

  it("maintains different counters for different block classes across includes", async () => {
    const fs = new MemoryFileSystem({
      "main.md": `::: {.theorem #thm:one}
First theorem.
:::

::: {.definition #def:one}
First definition.
:::

::: {.include}
chapter.md
:::`,
      "chapter.md": `::: {.theorem #thm:two}
Second theorem.
:::

::: {.definition #def:two}
Second definition.
:::`,
    });

    const result = await processIncludes(
      "main.md",
      await fs.readFile("main.md"),
      fs,
    );
    expect(isIncludeError(result)).toBe(false);
    if (isIncludeError(result)) return;

    expect(result.refMap.get("thm:one")?.label).toBe("Theorem 1");
    expect(result.refMap.get("thm:two")?.label).toBe("Theorem 2");
    expect(result.refMap.get("def:one")?.label).toBe("Definition 1");
    expect(result.refMap.get("def:two")?.label).toBe("Definition 2");
  });
});
