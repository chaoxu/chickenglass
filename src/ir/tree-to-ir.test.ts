import { describe, expect, it } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../parser";
import { treeToIR } from "./tree-to-ir";
import type { DocumentIR } from "./types";

const parser = baseParser.configure(markdownExtensions);

function parseDoc(doc: string): DocumentIR {
  const tree = parser.parse(doc);
  return treeToIR(tree, doc);
}

// ---------------------------------------------------------------------------
// Headings → Sections
// ---------------------------------------------------------------------------

describe("treeToIR: sections from headings", () => {
  it("converts flat headings into top-level sections", () => {
    const ir = parseDoc("# A\n\nParagraph.\n\n# B\n\nMore text.\n");

    expect(ir.sections).toHaveLength(2);
    expect(ir.sections[0].heading).toBe("A");
    expect(ir.sections[0].level).toBe(1);
    expect(ir.sections[0].number).toBe("1");
    expect(ir.sections[0].children).toHaveLength(0);

    expect(ir.sections[1].heading).toBe("B");
    expect(ir.sections[1].number).toBe("2");
  });

  it("nests sub-sections under parent headings", () => {
    const ir = parseDoc("# Top\n\n## Sub A\n\nText.\n\n## Sub B\n\n### Deep\n");

    expect(ir.sections).toHaveLength(1);
    const top = ir.sections[0];
    expect(top.heading).toBe("Top");
    expect(top.children).toHaveLength(2);
    expect(top.children[0].heading).toBe("Sub A");
    expect(top.children[0].children).toHaveLength(0);
    expect(top.children[1].heading).toBe("Sub B");
    expect(top.children[1].children).toHaveLength(1);
    expect(top.children[1].children[0].heading).toBe("Deep");
  });

  it("preserves explicit heading ids from Pandoc attributes", () => {
    const ir = parseDoc("# Introduction {#sec:intro}\n");

    expect(ir.sections).toHaveLength(1);
    expect(ir.sections[0].id).toBe("sec:intro");
    expect(ir.sections[0].heading).toBe("Introduction");
  });

  it("handles unnumbered headings", () => {
    const ir = parseDoc("# Numbered\n\n## Unnumbered {-}\n");

    expect(ir.sections[0].number).toBe("1");
    expect(ir.sections[0].children[0].number).toBe("");
  });

  it("section range extends to the next sibling heading", () => {
    const doc = "# A\n\nBody of A.\n\n# B\n\nBody of B.\n";
    const ir = parseDoc(doc);

    // Section A should end where section B starts
    expect(ir.sections[0].range.from).toBe(0);
    expect(ir.sections[0].range.to).toBe(ir.sections[1].range.from);
    // Section B should extend to end of document
    expect(ir.sections[1].range.to).toBe(doc.length);
  });
});

// ---------------------------------------------------------------------------
// Fenced divs → Blocks
// ---------------------------------------------------------------------------

describe("treeToIR: blocks from fenced divs", () => {
  it("extracts a theorem block with title and label", () => {
    const ir = parseDoc('::: {.theorem #thm-main title="Main Theorem"}\nStatement here.\n:::\n');

    expect(ir.blocks).toHaveLength(1);
    expect(ir.blocks[0].type).toBe("theorem");
    expect(ir.blocks[0].title).toBe("Main Theorem");
    expect(ir.blocks[0].label).toBe("thm-main");
    expect(ir.blocks[0].content).toBe("Statement here.");
  });

  it("handles a block without a title", () => {
    const ir = parseDoc("::: {.proof}\nDetails.\n:::\n");

    expect(ir.blocks).toHaveLength(1);
    expect(ir.blocks[0].type).toBe("proof");
    expect(ir.blocks[0].title).toBeUndefined();
    expect(ir.blocks[0].content).toBe("Details.");
  });

  it("extracts multiple blocks", () => {
    const doc = [
      '::: {.theorem title="T1"}',
      "Body 1.",
      ":::",
      "",
      '::: {.definition title="D1"}',
      "Body 2.",
      ":::",
      "",
    ].join("\n");
    const ir = parseDoc(doc);

    expect(ir.blocks).toHaveLength(2);
    expect(ir.blocks[0].type).toBe("theorem");
    expect(ir.blocks[1].type).toBe("definition");
  });

  it("assigns block numbers from the shared semantic counter model", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "Body 1.",
      ":::",
      "",
      "::: {.lemma #lem-a}",
      "Body 2.",
      ":::",
      "",
      "::: {.definition #def-a}",
      "Body 3.",
      ":::",
      "",
      "::: {.proof #proof-a}",
      "Body 4.",
      ":::",
      "",
    ].join("\n");
    const ir = parseDoc(doc);

    expect(ir.blocks.map((block) => [block.type, block.number])).toEqual([
      ["theorem", 1],
      ["lemma", 2],
      ["definition", 1],
      ["proof", undefined],
    ]);
  });

  it("uses frontmatter custom block counters for IR block numbers", () => {
    const doc = [
      "---",
      "blocks:",
      "  claim:",
      "    counter: theorem",
      "    numbered: true",
      "---",
      "",
      "::: {.theorem #thm-a}",
      "Body 1.",
      ":::",
      "",
      "::: {.claim #claim-a}",
      "Body 2.",
      ":::",
      "",
    ].join("\n");
    const ir = parseDoc(doc);

    expect(ir.blocks.map((block) => [block.type, block.number])).toEqual([
      ["theorem", 1],
      ["claim", 2],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Math (labeled equations)
// ---------------------------------------------------------------------------

describe("treeToIR: math from labeled equations", () => {
  it("extracts labeled display math", () => {
    const ir = parseDoc("$$x^2 + y^2 = z^2$$ {#eq:pyth}\n");

    expect(ir.math).toHaveLength(1);
    expect(ir.math[0].latex).toBe("x^2 + y^2 = z^2");
    expect(ir.math[0].display).toBe(true);
    expect(ir.math[0].label).toBe("eq:pyth");
    expect(ir.math[0].number).toBe(1);
  });

  it("numbers multiple equations sequentially", () => {
    const doc = "$$a$$ {#eq:a}\n\n$$b$$ {#eq:b}\n";
    const ir = parseDoc(doc);

    expect(ir.math).toHaveLength(2);
    expect(ir.math[0].number).toBe(1);
    expect(ir.math[0].label).toBe("eq:a");
    expect(ir.math[1].number).toBe(2);
    expect(ir.math[1].label).toBe("eq:b");
  });
});

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

describe("treeToIR: references", () => {
  it("extracts bracketed references", () => {
    const ir = parseDoc("See [@thm-main].\n");

    expect(ir.references).toHaveLength(1);
    expect(ir.references[0].ids).toEqual(["thm-main"]);
    expect(ir.references[0].bracketed).toBe(true);
  });

  it("extracts narrative references", () => {
    const ir = parseDoc("See @eq:first for details.\n");

    expect(ir.references).toHaveLength(1);
    expect(ir.references[0].ids).toEqual(["eq:first"]);
    expect(ir.references[0].bracketed).toBe(false);
  });

  it("extracts both reference types in one document", () => {
    const ir = parseDoc("See [@thm-main] and @eq:first.\n");

    expect(ir.references).toHaveLength(2);
    expect(ir.references[0].bracketed).toBe(true);
    expect(ir.references[1].bracketed).toBe(false);
  });

  it("extracts multi-id bracketed references", () => {
    const ir = parseDoc("See [@eq:a; @eq:b].\n");

    expect(ir.references).toHaveLength(1);
    expect(ir.references[0].ids).toEqual(["eq:a", "eq:b"]);
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe("treeToIR: tables", () => {
  it("extracts a simple table with header and body rows", () => {
    const doc = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
      "",
    ].join("\n");
    const ir = parseDoc(doc);

    expect(ir.tables).toHaveLength(1);
    expect(ir.tables[0].header.cells).toEqual([
      { content: "A" },
      { content: "B" },
    ]);
    expect(ir.tables[0].rows).toHaveLength(2);
    expect(ir.tables[0].rows[0].cells).toEqual([
      { content: "1" },
      { content: "2" },
    ]);
    expect(ir.tables[0].rows[1].cells).toEqual([
      { content: "3" },
      { content: "4" },
    ]);
  });

  it("handles a table with a single body row", () => {
    const doc = "| X |\n| --- |\n| Y |\n";
    const ir = parseDoc(doc);

    expect(ir.tables).toHaveLength(1);
    expect(ir.tables[0].header.cells).toEqual([{ content: "X" }]);
    expect(ir.tables[0].rows).toHaveLength(1);
    expect(ir.tables[0].rows[0].cells).toEqual([{ content: "Y" }]);
  });
});

// ---------------------------------------------------------------------------
// Metadata (frontmatter)
// ---------------------------------------------------------------------------

describe("treeToIR: metadata from frontmatter", () => {
  it("extracts title, author, and date", () => {
    const doc = [
      "---",
      "title: My Paper",
      "author: Alice",
      "date: 2024-01-01",
      "---",
      "",
      "# Introduction",
      "",
    ].join("\n");
    const ir = parseDoc(doc);

    expect(ir.metadata.title).toBe("My Paper");
    expect(ir.metadata.author).toBe("Alice");
    expect(ir.metadata.date).toBe("2024-01-01");
  });

  it("returns empty metadata when there is no frontmatter", () => {
    const ir = parseDoc("# Just a heading\n");

    expect(ir.metadata.title).toBeUndefined();
    expect(ir.metadata.author).toBeUndefined();
    expect(ir.metadata.raw).toEqual({});
  });

  it("preserves all raw frontmatter fields", () => {
    const doc = "---\ntitle: T\ncustom: value\n---\n\nBody.\n";
    const ir = parseDoc(doc);

    expect(ir.metadata.raw).toMatchObject({
      title: "T",
      custom: "value",
    });
  });
});

// ---------------------------------------------------------------------------
// Mixed document
// ---------------------------------------------------------------------------

describe("treeToIR: mixed document", () => {
  it("produces a complete IR from a realistic document", () => {
    const doc = [
      "---",
      "title: Test Document",
      "---",
      "",
      "# Introduction {#sec:intro}",
      "",
      "Some text with a reference [@thm-main].",
      "",
      '::: {.theorem #thm-main title="Main Theorem"}',
      "Statement here.",
      ":::",
      "",
      "$$x^2 + y^2$$ {#eq:pyth}",
      "",
      "## Details",
      "",
      "| Col A | Col B |",
      "| --- | --- |",
      "| val1 | val2 |",
      "",
      "See @eq:pyth for details.",
      "",
    ].join("\n");
    const ir = parseDoc(doc);

    // Metadata
    expect(ir.metadata.title).toBe("Test Document");

    // Sections: one top-level with one sub-section
    expect(ir.sections).toHaveLength(1);
    expect(ir.sections[0].heading).toBe("Introduction");
    expect(ir.sections[0].id).toBe("sec:intro");
    expect(ir.sections[0].children).toHaveLength(1);
    expect(ir.sections[0].children[0].heading).toBe("Details");

    // Blocks
    expect(ir.blocks).toHaveLength(1);
    expect(ir.blocks[0].type).toBe("theorem");
    expect(ir.blocks[0].label).toBe("thm-main");

    // Math
    expect(ir.math).toHaveLength(1);
    expect(ir.math[0].label).toBe("eq:pyth");

    // References (bracketed + narrative)
    expect(ir.references.length).toBeGreaterThanOrEqual(2);

    // Tables
    expect(ir.tables).toHaveLength(1);
    expect(ir.tables[0].header.cells).toHaveLength(2);
  });
});
