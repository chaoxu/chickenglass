import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { highlightExtension } from "./highlight";

/** Helper: parse text with highlight extension and return all node names at their ranges. */
function parseNodes(text: string): Array<{ name: string; from: number; to: number }> {
  const mdParser = parser.configure(highlightExtension);
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

describe("highlight syntax ==...==", () => {
  it("parses ==text== as Highlight", () => {
    const nodes = findNodes("hello ==world== end", "Highlight");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(6);
    expect(nodes[0].to).toBe(15);
  });

  it("produces HighlightMark nodes for == delimiters", () => {
    const nodes = findNodes("==hi==", "HighlightMark");
    expect(nodes).toHaveLength(2);
    // Opening == mark
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(2);
    // Closing == mark
    expect(nodes[1].from).toBe(4);
    expect(nodes[1].to).toBe(6);
  });

  it("handles empty highlight ====", () => {
    const nodes = findNodes("====", "Highlight");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(4);
  });

  it("handles multiple highlights on one line", () => {
    const nodes = findNodes("==a== and ==b==", "Highlight");
    expect(nodes).toHaveLength(2);
  });

  it("does not parse a single = as highlight", () => {
    const nodes = findNodes("=text=", "Highlight");
    expect(nodes).toHaveLength(0);
  });

  it("does not match unclosed == as highlight", () => {
    const nodes = findNodes("==unclosed", "Highlight");
    expect(nodes).toHaveLength(0);
  });

  it("parses highlighted text at start of line", () => {
    const nodes = findNodes("==start==", "Highlight");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(9);
  });

  it("parses highlighted text with spaces inside", () => {
    const nodes = findNodes("==hello world==", "Highlight");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(15);
  });
});
