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
});
