import { describe, expect, it } from "vitest";

import {
  extractFileIndex,
  updateFileInIndex,
  removeFileFromIndex,
} from "./extract";
import { queryIndex } from "./query-api";
import type { FileIndex } from "./query-api";

describe("extractFileIndex", () => {
  describe("fenced divs", () => {
    it("extracts a basic theorem block", () => {
      const content = `::: {.theorem #thm-1} Main Result
Let $x$ be a positive integer.
:::`;
      const result = extractFileIndex(content, "test.md");

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe("theorem");
      expect(result.entries[0].label).toBe("thm-1");
      expect(result.entries[0].title).toBe("Main Result");
      expect(result.entries[0].content).toContain("Let $x$ be a positive integer.");
    });

    it("extracts a block without label", () => {
      const content = `::: {.proof}
This follows directly.
:::`;
      const result = extractFileIndex(content, "test.md");

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe("proof");
      expect(result.entries[0].label).toBeUndefined();
    });

    it("extracts multiple blocks", () => {
      const content = `::: {.theorem #thm-a}
First theorem.
:::

::: {.definition #def-1}
A definition.
:::

::: {.proof}
The proof.
:::`;
      const result = extractFileIndex(content, "test.md");

      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].type).toBe("theorem");
      expect(result.entries[1].type).toBe("definition");
      expect(result.entries[2].type).toBe("proof");
    });

    it("handles nested fenced divs", () => {
      const content = `:::: {.theorem #outer}
Outer content.

::: {.proof}
Inner proof.
:::
::::`;
      const result = extractFileIndex(content, "test.md");

      // Regex-based extraction captures both opening fences
      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      const types = result.entries.map((e) => e.type);
      expect(types).toContain("theorem");
      expect(types).toContain("proof");
    });

    it("extracts block with title only (no label)", () => {
      const content = `::: {.remark} A Note
Some remark content.
:::`;
      const result = extractFileIndex(content, "test.md");

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe("remark");
      expect(result.entries[0].title).toBe("A Note");
    });
  });

  describe("equation labels", () => {
    it("extracts an equation label", () => {
      const content = `Some text.

$$ e^{i\\pi} + 1 = 0 $$ {#eq:euler}

More text.`;
      const result = extractFileIndex(content, "math.md");

      const equations = result.entries.filter((e) => e.type === "equation");
      expect(equations).toHaveLength(1);
      expect(equations[0].label).toBe("eq:euler");
    });

    it("extracts multiple equation labels", () => {
      const content = `$$ a^2 + b^2 = c^2 $$ {#eq:pythag}

$$ F = ma $$ {#eq:newton}`;
      const result = extractFileIndex(content, "formulas.md");

      const equations = result.entries.filter((e) => e.type === "equation");
      expect(equations).toHaveLength(2);
      expect(equations[0].label).toBe("eq:pythag");
      expect(equations[1].label).toBe("eq:newton");
    });
  });

  describe("headings", () => {
    it("extracts headings with labels", () => {
      const content = `# Introduction {#sec:intro}

Some text.

## Background {#sec:bg}`;
      const result = extractFileIndex(content, "doc.md");

      const headings = result.entries.filter((e) => e.type === "heading");
      expect(headings).toHaveLength(2);
      expect(headings[0].label).toBe("sec:intro");
      expect(headings[0].title).toBe("Introduction");
      expect(headings[0].number).toBe("1");
      expect(headings[1].label).toBe("sec:bg");
      expect(headings[1].number).toBe("1.1");
    });

    it("extracts headings without labels", () => {
      const content = `# Introduction

## Methods`;
      const result = extractFileIndex(content, "doc.md");

      const headings = result.entries.filter((e) => e.type === "heading");
      expect(headings).toHaveLength(2);
      expect(headings[0].label).toBeUndefined();
      expect(headings[0].title).toBe("Introduction");
    });
  });

  describe("references", () => {
    it("extracts cross-references", () => {
      const content = `By [@thm-1], we know that [@eq:euler] holds.`;
      const result = extractFileIndex(content, "doc.md");

      expect(result.references).toHaveLength(2);
      expect(result.references[0].ids).toEqual(["thm-1"]);
      expect(result.references[1].ids).toEqual(["eq:euler"]);
    });

    it("tracks reference positions", () => {
      const content = `See [@thm-1].`;
      const result = extractFileIndex(content, "doc.md");

      expect(result.references).toHaveLength(1);
      expect(result.references[0].position.from).toBe(4);
      expect(result.references[0].position.to).toBe(12);
    });

    it("extracts references from block content", () => {
      const content = `::: {.proof}
By [@thm-main] and [@eq:key], this follows.
:::`;
      const result = extractFileIndex(content, "doc.md");

      expect(result.references).toHaveLength(2);
    });

    it("indexes narrative references (@id)", () => {
      const content = `As shown in @thm-main, we have the result.`;
      const result = extractFileIndex(content, "doc.md");

      expect(result.references).toHaveLength(1);
      expect(result.references[0].ids).toEqual(["thm-main"]);
      expect(result.references[0].bracketed).toBe(false);
    });

    it("indexes multi-id reference clusters ([@a; @b])", () => {
      const content = `See [@thm-1; @thm-2] for details.`;
      const result = extractFileIndex(content, "doc.md");

      expect(result.references).toHaveLength(1);
      expect(result.references[0].ids).toEqual(["thm-1", "thm-2"]);
      expect(result.references[0].bracketed).toBe(true);
    });

    it("indexes references with locators", () => {
      const content = `See [@smith2020, p. 42] for the proof.`;
      const result = extractFileIndex(content, "doc.md");

      expect(result.references).toHaveLength(1);
      expect(result.references[0].ids).toEqual(["smith2020"]);
      expect(result.references[0].locators).toEqual(["p. 42"]);
    });
  });

  describe("heading numbering", () => {
    it("produces nested heading numbers", () => {
      const content = `# Chapter

## Section

### Subsection`;
      const result = extractFileIndex(content, "doc.md");

      const headings = result.entries.filter((e) => e.type === "heading");
      expect(headings).toHaveLength(3);
      expect(headings[0].number).toBe("1");
      expect(headings[1].number).toBe("1.1");
      expect(headings[2].number).toBe("1.1.1");
    });

    it("omits number for unnumbered headings", () => {
      const content = `# Preface {-}

# Introduction`;
      const result = extractFileIndex(content, "doc.md");

      const headings = result.entries.filter((e) => e.type === "heading");
      expect(headings).toHaveLength(2);
      expect(headings[0].number).toBeUndefined();
      expect(headings[1].number).toBe("1");
    });
  });

  describe("code block edge cases", () => {
    it("ignores headings inside fenced code blocks", () => {
      const content = `\`\`\`markdown
# Fake heading {#fake}
\`\`\`

# Real heading {#real}`;
      const result = extractFileIndex(content, "test.md");

      const headings = result.entries.filter((e) => e.type === "heading");
      expect(headings).toHaveLength(1);
      expect(headings[0].label).toBe("real");
      expect(headings[0].title).toBe("Real heading");
    });

    it("ignores fenced divs inside fenced code blocks", () => {
      const content = `\`\`\`
::: {.theorem #fake-thm}
Fake theorem content.
:::
\`\`\`

::: {.theorem #real-thm}
Real theorem.
:::`;
      const result = extractFileIndex(content, "test.md");

      const theorems = result.entries.filter((e) => e.type === "theorem");
      expect(theorems).toHaveLength(1);
      expect(theorems[0].label).toBe("real-thm");
    });

    it("ignores equation labels inside fenced code blocks", () => {
      const content = `\`\`\`latex
$$ x^2 $$ {#eq:fake}
\`\`\`

$$ y^2 $$ {#eq:real}`;
      const result = extractFileIndex(content, "test.md");

      const equations = result.entries.filter((e) => e.type === "equation");
      expect(equations).toHaveLength(1);
      expect(equations[0].label).toBe("eq:real");
    });

    it("ignores references inside fenced code blocks", () => {
      const content = `\`\`\`
[@fake-ref]
\`\`\`

See [@real-ref].`;
      const result = extractFileIndex(content, "test.md");

      expect(result.references).toHaveLength(1);
      expect(result.references[0].ids).toEqual(["real-ref"]);
    });

    it("ignores references inside inline code", () => {
      const content = "Use `[@fake-ref]` syntax for references. See [@real-ref].";
      const result = extractFileIndex(content, "test.md");

      expect(result.references).toHaveLength(1);
      expect(result.references[0].ids).toEqual(["real-ref"]);
    });
  });

  describe("mixed content", () => {
    it("extracts all types from a realistic document", () => {
      const content = `---
title: My Paper
---

# Introduction {#sec:intro}

We study groups as defined below.

::: {.definition #def-group}
A **group** is a set $G$ with an operation.
:::

::: {.theorem #thm-main} Main Theorem
Every finite group has an identity element.
:::

By [@def-group], the identity in [@thm-main] is unique.

$$ |G| = \\sum_{i} |C_i| $$ {#eq:class}

See [@eq:class] for the class equation.`;
      const result = extractFileIndex(content, "paper.md");

      const types = result.entries.map((e) => e.type);
      expect(types).toContain("heading");
      expect(types).toContain("definition");
      expect(types).toContain("theorem");
      expect(types).toContain("equation");

      expect(result.references.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("incremental updates", () => {
  it("adds a new file to the index", () => {
    const files = new Map<string, FileIndex>();
    const content = `::: {.theorem #thm-new}
New theorem.
:::`;
    const updated = updateFileInIndex(files, "new.md", content);

    expect(updated.size).toBe(1);
    const fileIndex = updated.get("new.md");
    expect(fileIndex?.entries).toHaveLength(1);
    expect(fileIndex?.entries[0].label).toBe("thm-new");
  });

  it("replaces existing file index on update", () => {
    const initialContent = `::: {.theorem #old}
Old.
:::`;
    const files = updateFileInIndex(new Map(), "doc.md", initialContent);
    expect(files.get("doc.md")?.entries[0].label).toBe("old");

    const newContent = `::: {.definition #new-def}
New definition.
:::`;
    const updated = updateFileInIndex(files, "doc.md", newContent);
    expect(updated.get("doc.md")?.entries).toHaveLength(1);
    expect(updated.get("doc.md")?.entries[0].label).toBe("new-def");
    expect(updated.get("doc.md")?.entries[0].type).toBe("definition");
  });

  it("preserves other files when updating one", () => {
    let files = updateFileInIndex(new Map(), "a.md", `::: {.theorem #a}
A.
:::`);
    files = updateFileInIndex(files, "b.md", `::: {.definition #b}
B.
:::`);

    const updated = updateFileInIndex(files, "a.md", `::: {.lemma #a-new}
Updated.
:::`);

    expect(updated.size).toBe(2);
    expect(updated.get("a.md")?.entries[0].type).toBe("lemma");
    expect(updated.get("b.md")?.entries[0].type).toBe("definition");
  });

  it("removes a file from the index", () => {
    let files = updateFileInIndex(new Map(), "a.md", "# Hello");
    files = updateFileInIndex(files, "b.md", "# World");

    const updated = removeFileFromIndex(files, "a.md");
    expect(updated.size).toBe(1);
    expect(updated.has("a.md")).toBe(false);
    expect(updated.has("b.md")).toBe(true);
  });

  it("supports cross-file queries after incremental updates", () => {
    let files = updateFileInIndex(
      new Map(),
      "ch1.md",
      `::: {.theorem #thm-1}
First.
:::`,
    );
    files = updateFileInIndex(
      files,
      "ch2.md",
      `::: {.theorem #thm-2}
Second.
:::

See [@thm-1].`,
    );

    const index = { files };
    const theorems = queryIndex(index, { type: "theorem" });
    expect(theorems).toHaveLength(2);
  });
});
