import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { strikethroughExtension } from "./strikethrough";

/** Helper: parse text with strikethrough extension and return all nodes. */
function parseNodes(text: string): Array<{ name: string; from: number; to: number }> {
  const mdParser = parser.configure(strikethroughExtension);
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

describe("strikethrough with ~~", () => {
  it("parses ~~text~~ as Strikethrough", () => {
    const nodes = findNodes("hello ~~world~~ end", "Strikethrough");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(6);
    expect(nodes[0].to).toBe(15);
  });

  it("produces StrikethroughMark nodes for ~~ delimiters", () => {
    const marks = findNodes("~~abc~~", "StrikethroughMark");
    expect(marks).toHaveLength(2);
    // Opening ~~
    expect(marks[0].from).toBe(0);
    expect(marks[0].to).toBe(2);
    // Closing ~~
    expect(marks[1].from).toBe(5);
    expect(marks[1].to).toBe(7);
  });

  it("handles multiple strikethroughs on one line", () => {
    const nodes = findNodes("~~a~~ and ~~b~~", "Strikethrough");
    expect(nodes).toHaveLength(2);
  });

  it("does not parse single ~ as strikethrough", () => {
    const nodes = findNodes("~text~", "Strikethrough");
    expect(nodes).toHaveLength(0);
  });

  it("does not parse ~~~ as strikethrough start", () => {
    const nodes = findNodes("~~~text~~~", "Strikethrough");
    expect(nodes).toHaveLength(0);
  });

  it("parses strikethrough with inner content", () => {
    const nodes = findNodes("~~hello world~~", "Strikethrough");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(15);
  });

  it("does not parse unclosed ~~", () => {
    const nodes = findNodes("~~unclosed", "Strikethrough");
    expect(nodes).toHaveLength(0);
  });
});
