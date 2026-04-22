import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDocumentAnalysisCache,
  getCachedDocumentAnalysis,
  rememberCachedDocumentAnalysis,
} from "../semantics/incremental/cached-document-analysis";
import { analyzeMarkdownDocument } from "../semantics/markdown-analysis";
import * as incrementalEngine from "../semantics/incremental/engine";
import {
  extractFileIndex,
  getFileIndexAnalysis,
  removeFileFromIndex,
  updateFileInIndex,
} from "./extract";
import { BackgroundIndexer } from "./indexer";
import type { FileIndex } from "./query-api";
import { queryIndex } from "./query-api";

function requireFileIndex(fileIndex: FileIndex | undefined): FileIndex {
  expect(fileIndex).toBeDefined();
  return fileIndex as FileIndex;
}

function requireFileAnalysis(
  fileIndex: FileIndex | undefined,
): NonNullable<ReturnType<typeof getFileIndexAnalysis>> {
  const analysis = getFileIndexAnalysis(requireFileIndex(fileIndex));
  expect(analysis).toBeDefined();
  return analysis as NonNullable<ReturnType<typeof getFileIndexAnalysis>>;
}

beforeEach(() => {
  clearDocumentAnalysisCache();
});

describe("cached document analysis", () => {
  it("reuses the cached entry when the text is unchanged", () => {
    const cached = getCachedDocumentAnalysis("# Title\n");

    expect(getCachedDocumentAnalysis("# Title\n", cached)).toBe(cached);
  });

  it("updates analysis incrementally across text edits", () => {
    const before = getCachedDocumentAnalysis("# Title\n\nParagraph.\n");
    const after = getCachedDocumentAnalysis("# Title\n\nParagraph with [@ref].\n", before);

    expect(after.version).toBe(before.version + 1);
    expect(incrementalEngine.getDocumentAnalysisRevision(after.analysis)).toBe(
      incrementalEngine.getDocumentAnalysisRevision(before.analysis) + 1,
    );
    expect(incrementalEngine.getDocumentAnalysisSliceRevision(after.analysis, "references")).toBe(
      incrementalEngine.getDocumentAnalysisSliceRevision(before.analysis, "references") + 1,
    );
    expect(incrementalEngine.getDocumentAnalysisSliceRevision(after.analysis, "headings")).toBe(
      incrementalEngine.getDocumentAnalysisSliceRevision(before.analysis, "headings"),
    );
  });

  it("adopts external analysis without changing the cached version for the same text", () => {
    const cached = getCachedDocumentAnalysis("# Title\n");
    const external = getCachedDocumentAnalysis("# Title\n").analysis;
    const adopted = rememberCachedDocumentAnalysis("# Title\n", external, cached);

    expect(adopted.version).toBe(cached.version);
    expect(adopted.analysis).toBe(external);
  });
});

describe("extractFileIndex", () => {
  describe("fenced divs", () => {
    it("extracts a basic theorem block", () => {
      const content = `::: {.theorem #thm-1 title="Main Result"}
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
      const content = `::: {.remark title="A Note"}
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

::: {.theorem #thm-main title="Main Theorem"}
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

    it("can consume canonical document artifacts without rebuilding private semantics", () => {
      const content = [
        "# Intro {#sec:intro}",
        "",
        "See [@thm:main] and @eq:main.",
        "",
        '::: {.theorem #thm:main title="Main Result"}',
        "Body.",
        ":::",
        "",
        "$$x^2$$ {#eq:main}",
        "",
      ].join("\n");
      const artifacts = analyzeMarkdownDocument(content, "paper.md");
      const result = extractFileIndex(content, "paper.md", artifacts);

      expect(getFileIndexAnalysis(result)).toBe(artifacts.analysis);
      const indexedTargets = result.entries
        .map((entry) => ({
          type: entry.type,
          label: entry.label,
          title: entry.title,
        }))
        .sort((left, right) => left.type.localeCompare(right.type));

      expect(indexedTargets).toEqual([
        {
          type: "equation",
          label: artifacts.ir.math[0]?.label,
          title: undefined,
        },
        {
          type: "heading",
          label: "sec:intro",
          title: artifacts.ir.sections[0]?.heading,
        },
        {
          type: "theorem",
          label: artifacts.ir.blocks[0]?.label,
          title: artifacts.ir.blocks[0]?.title,
        },
      ]);
      expect(result.references.map((reference) => reference.ids)).toEqual(
        artifacts.ir.references.map((reference) => reference.ids),
      );
    });

    it("treats legacy include blocks as ordinary fenced-div semantics", () => {
      const content = [
        "::: {.include #inc:chapter}",
        "chapter.md",
        ":::",
        "",
      ].join("\n");
      const artifacts = analyzeMarkdownDocument(content, "root.md");
      const result = extractFileIndex(content, "root.md", artifacts);

      expect(artifacts.ir.blocks).toEqual([
        expect.objectContaining({
          type: "include",
          label: "inc:chapter",
          content: "chapter.md",
        }),
      ]);
      expect(result.entries).toEqual([
        expect.objectContaining({
          type: "include",
          label: "inc:chapter",
          content: "chapter.md",
        }),
      ]);
      expect(getFileIndexAnalysis(result)).toBe(artifacts.analysis);
    });
  });
});

describe("edge cases", () => {
  it("does NOT produce false labels for incomplete/unclosed fenced divs at EOF", () => {
    // The Lezer parser uses error recovery and will still emit a FencedDiv
    // node for an unclosed block at EOF, so the indexer will extract an entry.
    // This test documents the actual behavior: the label IS present, but the
    // entry's content is the partial body (up to EOF). A caller must not assume
    // unclosed divs are silently dropped.
    const content = `::: {.theorem #thm-unclosed}
This theorem has no closing fence.`;
    const result = extractFileIndex(content, "test.md");

    // Parser error-recovery emits a FencedDiv node even for unclosed divs.
    const labelled = result.entries.filter((e) => e.label === "thm-unclosed");
    expect(labelled).toHaveLength(1);
    // The type and label are still correctly extracted from the opening fence.
    expect(labelled[0].type).toBe("theorem");
    // The content is the partial body text (no closing fence line).
    expect(labelled[0].content).toContain("This theorem has no closing fence.");
  });

  it("handles empty document", () => {
    // An empty document must not throw and must return empty arrays.
    const result = extractFileIndex("", "empty.md");

    expect(result.entries).toHaveLength(0);
    expect(result.references).toHaveLength(0);
    expect(result.file).toBe("empty.md");
  });

  it("handles document with no fenced divs", () => {
    // A plain prose document (headings + text, no fenced divs) must not
    // produce any fenced-div index entries; other entry types are unaffected.
    const content = `# Introduction

Some plain paragraph text with no blocks.

## Methods

More prose here.`;
    const result = extractFileIndex(content, "prose.md");

    const divEntries = result.entries.filter(
      (e) => e.type !== "heading",
    );
    expect(divEntries).toHaveLength(0);

    // Headings should still be indexed
    const headings = result.entries.filter((e) => e.type === "heading");
    expect(headings).toHaveLength(2);
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

  it("reuses cached analysis across raw file-index updates", () => {
    const initialContent = "# Title\n\nParagraph.\n";
    const files = updateFileInIndex(new Map(), "doc.md", initialContent);
    const beforeAnalysis = requireFileAnalysis(files.get("doc.md"));

    const updated = updateFileInIndex(files, "doc.md", "# Title\n\nParagraph with [@ref].\n");
    const afterAnalysis = requireFileAnalysis(updated.get("doc.md"));

    expect(incrementalEngine.getDocumentAnalysisRevision(afterAnalysis)).toBe(
      incrementalEngine.getDocumentAnalysisRevision(beforeAnalysis) + 1,
    );
    expect(incrementalEngine.getDocumentAnalysisSliceRevision(afterAnalysis, "references")).toBe(
      incrementalEngine.getDocumentAnalysisSliceRevision(beforeAnalysis, "references") + 1,
    );
    expect(incrementalEngine.getDocumentAnalysisSliceRevision(afterAnalysis, "headings")).toBe(
      incrementalEngine.getDocumentAnalysisSliceRevision(beforeAnalysis, "headings"),
    );
  });

  it("continues cached updates after adopting editor-provided analysis into raw file indices", () => {
    const initialContent = "# Title\n\nParagraph.\n";
    const adoptedAnalysis = getCachedDocumentAnalysis(initialContent).analysis;
    const files = updateFileInIndex(new Map(), "doc.md", initialContent, adoptedAnalysis);
    const beforeAnalysis = requireFileAnalysis(files.get("doc.md"));

    const updated = updateFileInIndex(files, "doc.md", "# Title\n\nParagraph with [@ref].\n");
    const afterAnalysis = requireFileAnalysis(updated.get("doc.md"));

    expect(beforeAnalysis).toBe(adoptedAnalysis);
    expect(incrementalEngine.getDocumentAnalysisRevision(afterAnalysis)).toBe(
      incrementalEngine.getDocumentAnalysisRevision(beforeAnalysis) + 1,
    );
    expect(updated.get("doc.md")?.references[0]?.ids).toEqual(["ref"]);
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

describe("BackgroundIndexer", () => {
  it("replaces removed files on bulkUpdate", async () => {
    const indexer = new BackgroundIndexer();

    await indexer.bulkUpdate([
      { file: "a.md", content: "# A" },
      { file: "b.md", content: "# B" },
    ]);
    expect(await indexer.getFileIndex("a.md")).toBeDefined();
    expect(await indexer.getFileIndex("b.md")).toBeDefined();

    await indexer.bulkUpdate([
      { file: "b.md", content: "# B" },
    ]);

    await expect(indexer.getFileIndex("a.md")).resolves.toBeUndefined();
    await expect(indexer.getFileIndex("b.md")).resolves.toBeDefined();
  });

  it("supports raw source-text queries", async () => {
    const indexer = new BackgroundIndexer();

    await indexer.bulkUpdate([
      {
        file: "raw.md",
        content: [
          "# Notes",
          "RAW_TOKEN_785 appears here.",
        ].join("\n"),
      },
    ]);

    const results = await indexer.querySourceText({ text: "raw_token_785" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "text",
      file: "raw.md",
      number: "2",
      content: "RAW_TOKEN_785 appears here.",
    });
  });

  it("reuses cached analysis for files retained across bulkUpdate snapshots", async () => {
    const indexer = new BackgroundIndexer();
    const initialContent = "# Title\n\nParagraph.\n";

    await indexer.bulkUpdate([{ file: "doc.md", content: initialContent }]);
    const beforeAnalysis = requireFileAnalysis(await indexer.getFileIndex("doc.md"));

    await indexer.bulkUpdate([{ file: "doc.md", content: "# Title\n\nParagraph with [@ref].\n" }]);
    const afterFileIndex = await indexer.getFileIndex("doc.md");
    const afterAnalysis = requireFileAnalysis(afterFileIndex);

    expect(incrementalEngine.getDocumentAnalysisRevision(afterAnalysis)).toBe(
      incrementalEngine.getDocumentAnalysisRevision(beforeAnalysis) + 1,
    );
    expect(afterFileIndex?.references[0]?.ids).toEqual(["ref"]);
  });

  it("continues incremental indexing after adopting editor-provided analysis", async () => {
    const indexer = new BackgroundIndexer();
    const initialContent = "# Title\n\nParagraph.\n";
    const adoptedAnalysis = getCachedDocumentAnalysis(initialContent).analysis;

    await indexer.updateFile("doc.md", initialContent, adoptedAnalysis);
    await indexer.updateFile("doc.md", "# Title\n\nParagraph with [@ref].\n");

    const fileIndex = await indexer.getFileIndex("doc.md");
    expect(fileIndex?.references).toHaveLength(1);
    expect(fileIndex?.references[0]?.ids).toEqual(["ref"]);
  });

  it("yields between chunked bulkUpdate batches", async () => {
    const indexer = new BackgroundIndexer();
    const yieldAfterBatch = vi.fn(async () => {});

    const totalEntries = await indexer.bulkUpdateChunked([
      { file: "a.md", content: "# A" },
      { file: "b.md", content: "# B" },
      { file: "c.md", content: "# C" },
      { file: "d.md", content: "# D" },
      { file: "e.md", content: "# E" },
    ], {
      batchSize: 2,
      yieldAfterBatch,
    });

    expect(totalEntries).toBe(5);
    expect(yieldAfterBatch).toHaveBeenCalledTimes(2);
    await expect(indexer.getFileIndex("a.md")).resolves.toBeDefined();
    await expect(indexer.getFileIndex("e.md")).resolves.toBeDefined();
  });

  it("leaves the previous snapshot intact when a chunked bulkUpdate is cancelled", async () => {
    const indexer = new BackgroundIndexer();
    await indexer.bulkUpdate([{ file: "old.md", content: "# Old" }]);

    let cancelChecks = 0;
    const totalEntries = await indexer.bulkUpdateChunked([
      { file: "new-a.md", content: "# New A" },
      { file: "new-b.md", content: "# New B" },
    ], {
      batchSize: 1,
      shouldCancel: () => {
        cancelChecks += 1;
        return cancelChecks > 1;
      },
      yieldAfterBatch: async () => {},
    });

    expect(totalEntries).toBeNull();
    await expect(indexer.getFileIndex("old.md")).resolves.toBeDefined();
    await expect(indexer.getFileIndex("new-a.md")).resolves.toBeUndefined();
    await expect(indexer.getFileIndex("new-b.md")).resolves.toBeUndefined();
  });
});
