import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { mathExtension } from "./math-backslash";

/** Helper: parse text with math extension and return all node names at their ranges. */
function parseNodes(text: string): Array<{ name: string; from: number; to: number }> {
  const mdParser = parser.configure(mathExtension);
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

describe("inline math with \\(\\)", () => {
  it("parses \\(x^2\\) as InlineMath", () => {
    const nodes = findNodes("hello \\(x^2\\) world", "InlineMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(6);
    expect(nodes[0].to).toBe(13);
  });

  it("produces InlineMathMark nodes for delimiters", () => {
    const nodes = findNodes("\\(x\\)", "InlineMathMark");
    expect(nodes).toHaveLength(2);
    // Opening \( mark
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(2);
    // Closing \) mark
    expect(nodes[1].from).toBe(3);
    expect(nodes[1].to).toBe(5);
  });

  it("handles empty inline math \\(\\)", () => {
    const nodes = findNodes("\\(\\)", "InlineMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(4);
  });

  it("handles multiple inline math on one line", () => {
    const nodes = findNodes("\\(a\\) and \\(b\\)", "InlineMath");
    expect(nodes).toHaveLength(2);
  });
});

describe("inline math with $", () => {
  it("parses $x^2$ as InlineMath", () => {
    const nodes = findNodes("hello $x^2$ world", "InlineMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(6);
    expect(nodes[0].to).toBe(11);
  });

  it("produces InlineMathMark nodes for $ delimiters", () => {
    const nodes = findNodes("$x$", "InlineMathMark");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(1);
    expect(nodes[1].from).toBe(2);
    expect(nodes[1].to).toBe(3);
  });

  it("handles backslash escapes inside $ math", () => {
    const nodes = findNodes("$a\\$b$", "InlineMath");
    // The \$ inside should be escaped, matching the outer $
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(6);
  });

  it("does not parse currency-like dollars as inline math", () => {
    expect(findNodes("Costs are $20 and $30 today.", "InlineMath")).toHaveLength(0);
  });

  it("requires tight opener and closer delimiters", () => {
    expect(findNodes("$ x$", "InlineMath")).toHaveLength(0);
    expect(findNodes("$x $", "InlineMath")).toHaveLength(0);
  });

  it("does not close dollar math before a digit", () => {
    expect(findNodes("$x$2", "InlineMath")).toHaveLength(0);
  });

  it("keeps escaped opening dollars literal", () => {
    const nodes = findNodes("Cost \\$x$ and valid $y$.", "InlineMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(20);
    expect(nodes[0].to).toBe(23);
  });
});

describe("dollar math is suppressed inside code", () => {
  it("backtick inline code suppresses $...$", () => {
    expect(findNodes("Inline `$x^2$` code", "InlineMath")).toHaveLength(0);
  });

  it("backtick fenced code block suppresses $...$", () => {
    expect(findNodes("```\n$x^2$\n```\n", "InlineMath")).toHaveLength(0);
  });

  it("tilde fenced code block suppresses $...$", () => {
    expect(findNodes("~~~\n$x^2$\n~~~\n", "InlineMath")).toHaveLength(0);
  });

  it("backtick fenced code block suppresses $$...$$", () => {
    expect(findNodes("```\n$$\nx^2\n$$\n```\n", "DisplayMath")).toHaveLength(0);
  });

  it("backtick inline code suppresses \\(...\\)", () => {
    expect(findNodes("Inline `\\(x^2\\)` code", "InlineMath")).toHaveLength(0);
  });
});

describe("both inline syntaxes produce the same node type", () => {
  it("\\(x\\) and $x$ both produce InlineMath", () => {
    const backslashNodes = findNodes("\\(x\\)", "InlineMath");
    const dollarNodes = findNodes("$x$", "InlineMath");
    expect(backslashNodes).toHaveLength(1);
    expect(dollarNodes).toHaveLength(1);
    // Same node name
    expect(backslashNodes[0].name).toBe(dollarNodes[0].name);
  });
});

describe("escaped backslash does NOT trigger math parsing", () => {
  it("\\\\( does not parse as inline math", () => {
    // \\( in source means an escaped backslash followed by literal (
    const text = "\\\\(x^2\\\\)";
    const inlineMath = findNodes(text, "InlineMath");
    expect(inlineMath).toHaveLength(0);
  });
});
