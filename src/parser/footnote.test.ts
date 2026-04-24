import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { footnoteExtension } from "./footnote";

/** Helper: parse text with footnote extension and return all node names at their ranges. */
function parseNodes(text: string): Array<{ name: string; from: number; to: number }> {
  const mdParser = parser.configure(footnoteExtension);
  const tree = mdParser.parse(text);
  const nodes: Array<{ name: string; from: number; to: number }> = [];
  tree.iterate({
    enter(node) {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

/** Helper: find all nodes with a given name. */
function findNodes(text: string, name: string) {
  return parseNodes(text).filter((n) => n.name === name);
}

describe("footnote reference [^id]", () => {
  it("parses [^1] as FootnoteRef", () => {
    const nodes = findNodes("text [^1] more", "FootnoteRef");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(5);
    expect(nodes[0].to).toBe(9);
  });

  it("parses [^abc] as FootnoteRef", () => {
    const nodes = findNodes("see [^abc] here", "FootnoteRef");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(4);
    expect(nodes[0].to).toBe(10);
  });

  it("handles multiple footnote refs on one line", () => {
    const nodes = findNodes("first [^1] and second [^2]", "FootnoteRef");
    expect(nodes).toHaveLength(2);
  });

  it("does not parse [^ ] with space", () => {
    const nodes = findNodes("text [^ 1] more", "FootnoteRef");
    expect(nodes).toHaveLength(0);
  });

  it("does not parse [^] with empty id", () => {
    const nodes = findNodes("text [^] more", "FootnoteRef");
    expect(nodes).toHaveLength(0);
  });

  it("does not parse [^id]: as a reference (that is a definition)", () => {
    const nodes = findNodes("[^1]: definition text", "FootnoteRef");
    expect(nodes).toHaveLength(0);
  });

  it("parses ref at start of line", () => {
    const nodes = findNodes("[^note] some text", "FootnoteRef");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(7);
  });

  it("parses ref with alphanumeric and hyphen id", () => {
    const nodes = findNodes("see [^my-note1]", "FootnoteRef");
    expect(nodes).toHaveLength(1);
  });
});

describe("footnote definition [^id]: content", () => {
  it("parses [^1]: text as FootnoteDef", () => {
    const nodes = findNodes("[^1]: See Smith (2020).", "FootnoteDef");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(23);
  });

  it("produces FootnoteDefLabel for the [^id]: part", () => {
    const nodes = findNodes("[^abc]: content", "FootnoteDefLabel");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(7); // [^abc]:
  });

  it("does not parse definition without colon", () => {
    const nodes = findNodes("[^1] just a ref", "FootnoteDef");
    expect(nodes).toHaveLength(0);
  });

  it("does not parse definition with space in id", () => {
    const nodes = findNodes("[^a b]: content", "FootnoteDef");
    expect(nodes).toHaveLength(0);
  });

  it("handles definition after other content", () => {
    const text = "Some text.\n\n[^1]: A footnote.";
    const nodes = findNodes(text, "FootnoteDef");
    expect(nodes).toHaveLength(1);
  });

  it("handles multiple definitions", () => {
    const text = "[^1]: First note.\n[^2]: Second note.";
    const nodes = findNodes(text, "FootnoteDef");
    expect(nodes).toHaveLength(2);
  });

  it("spans Pandoc multiline continuation lines", () => {
    const text = "Text[^1]\n\n[^1]: first line\n  second line";
    const defs = findNodes(text, "FootnoteDef");
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      from: text.indexOf("[^1]:"),
      to: text.length,
    });
  });

  it("stops before an unindented line after multiline content", () => {
    const text = "[^1]: first line\n  second line\nNext paragraph";
    const defs = findNodes(text, "FootnoteDef");
    expect(defs).toHaveLength(1);
    expect(text.slice(defs[0].from, defs[0].to)).toBe("[^1]: first line\n  second line");
  });
});

/**
 * REGRESSION: footnote definitions must interrupt paragraphs.
 *
 * Without the endLeaf callback, a [^id]: at the start of a line after
 * paragraph text gets swallowed into the paragraph as inline content
 * instead of starting a new FootnoteDef block. This matches Pandoc behavior
 * where footnote definitions always start a new block, even without a
 * blank line separator.
 */
describe("footnote def paragraph interruption (REGRESSION: missing endLeaf)", () => {
  it("footnote def interrupts a paragraph without blank line", () => {
    const text = "Some paragraph text.\n[^1]: A footnote definition.";
    const defs = findNodes(text, "FootnoteDef");
    expect(defs).toHaveLength(1);
    // The FootnoteDef should start at the [^1]: line, not be merged into the paragraph
    expect(defs[0].from).toBe(21); // "Some paragraph text.\n" is 21 chars
  });

  it("footnote def after paragraph creates separate blocks", () => {
    const text = "Paragraph text here.\n[^note]: Definition.";
    const paragraphs = findNodes(text, "Paragraph");
    const defs = findNodes(text, "FootnoteDef");
    expect(paragraphs).toHaveLength(1);
    expect(defs).toHaveLength(1);
    // Paragraph should NOT include the footnote def line
    expect(paragraphs[0].to).toBeLessThanOrEqual(defs[0].from);
  });

  it("multiple footnote defs after paragraph all parsed", () => {
    const text = "Text.\n[^1]: First.\n[^2]: Second.";
    const defs = findNodes(text, "FootnoteDef");
    expect(defs).toHaveLength(2);
  });
});
