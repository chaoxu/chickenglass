import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { mathExtension } from "./math-backslash";
import { equationLabelExtension } from "./equation-label";

/** Parse text with both math and equation label extensions. */
function parseNodes(text: string): Array<{ name: string; from: number; to: number }> {
  const mdParser = parser.configure([mathExtension, equationLabelExtension]);
  const tree = mdParser.parse(text);
  const nodes: Array<{ name: string; from: number; to: number }> = [];
  tree.iterate({
    enter(node) {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

/** Find all nodes with a given name. */
function findNodes(text: string, name: string) {
  return parseNodes(text).filter((n) => n.name === name);
}

/** Extract source text for a node. */
function nodeText(text: string, node: { from: number; to: number }): string {
  return text.slice(node.from, node.to);
}

describe("$$ display math with equation labels", () => {
  it("parses $$ x $$ {#eq:foo} with EquationLabel child", () => {
    const text = "$$x$$ {#eq:foo}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:foo}");
  });

  it("includes EquationLabel inside DisplayMath node", () => {
    const text = "$$x$$ {#eq:foo}";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].from).toBe(0);
    expect(display[0].to).toBe(text.length);
  });

  it("handles multi-line $$ with label on closing line", () => {
    const text = "$$\na + b\n$$ {#eq:sum}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:sum}");

    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].to).toBe(text.length);
  });

  it("parses $$ without label correctly", () => {
    const text = "$$x^2$$";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].from).toBe(0);
    expect(display[0].to).toBe(7);

    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });

  it("parses multi-line $$ without label correctly", () => {
    const text = "$$\na + b\n$$";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);

    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });

  it("still produces DisplayMathMark nodes with labels", () => {
    const text = "$$x$$ {#eq:foo}";
    const marks = findNodes(text, "DisplayMathMark");
    expect(marks).toHaveLength(2);
    expect(nodeText(text, marks[0])).toBe("$$");
    expect(nodeText(text, marks[1])).toBe("$$");
  });

  it("supports labels with colons and dashes", () => {
    const text = "$$x$$ {#eq:my-equation}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:my-equation}");
  });
});

describe("\\[\\] display math with equation labels", () => {
  it("parses \\[x\\] {#eq:bar} with EquationLabel child", () => {
    const text = "\\[x\\] {#eq:bar}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:bar}");
  });

  it("includes EquationLabel inside DisplayMath for \\[\\]", () => {
    const text = "\\[x\\] {#eq:bar}";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].from).toBe(0);
    expect(display[0].to).toBe(text.length);
  });

  it("handles multi-line \\[\\] with label on closing line", () => {
    const text = "\\[\na + b\n\\] {#eq:addition}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:addition}");

    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].to).toBe(text.length);
  });

  it("parses \\[\\] without label correctly", () => {
    const text = "\\[x^2\\]";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].from).toBe(0);
    expect(display[0].to).toBe(7);

    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });

  it("parses multi-line \\[\\] without label correctly", () => {
    const text = "\\[\na + b\n\\]";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);

    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });
});

describe("equation label edge cases", () => {
  it("does not create label for non-eq identifiers", () => {
    const text = "$$x$$ {#fig:foo}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });

  it("does not create label for malformed braces", () => {
    const text = "$$x$$ {#eq:foo";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });

  it("does not create label when text follows the label", () => {
    const text = "$$x$$ {#eq:foo} extra";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(0);
  });

  it("inline math is unaffected by equation label extension", () => {
    const text = "hello $x^2$ world";
    const nodes = findNodes(text, "InlineMath");
    expect(nodes).toHaveLength(1);
    expect(nodeText(text, nodes[0])).toBe("$x^2$");
  });

  it("inline backslash math is unaffected", () => {
    const text = "hello \\(x^2\\) world";
    const nodes = findNodes(text, "InlineMath");
    expect(nodes).toHaveLength(1);
    expect(nodeText(text, nodes[0])).toBe("\\(x^2\\)");
  });
});
