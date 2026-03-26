import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { mathExtension } from "./math-backslash";
import { equationLabelExtension } from "./equation-label";
import { fencedDiv } from "./fenced-div";

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

// ---------------------------------------------------------------------------
// Plain display math (no labels) — unified parser boundary
// ---------------------------------------------------------------------------

describe("plain display math with \\[\\]", () => {
  it("parses \\[x^2\\] as DisplayMath", () => {
    const nodes = findNodes("\\[x^2\\]", "DisplayMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(7);
  });

  it("produces DisplayMathMark nodes for \\[ \\] delimiters", () => {
    const nodes = findNodes("\\[x\\]", "DisplayMathMark");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(2);
    expect(nodes[1].from).toBe(3);
    expect(nodes[1].to).toBe(5);
  });

  it("handles multi-line \\[\\] display math", () => {
    const text = "\\[\na + b\n\\]";
    const nodes = findNodes(text, "DisplayMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(text.indexOf("\\]") + 2);
  });
});

describe("plain display math with $$", () => {
  it("parses $$x^2$$ as DisplayMath", () => {
    const nodes = findNodes("$$x^2$$", "DisplayMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(7);
  });

  it("handles multi-line $$ display math", () => {
    const text = "$$\na + b\n$$";
    const nodes = findNodes(text, "DisplayMath");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].from).toBe(0);
    expect(nodes[0].to).toBe(text.lastIndexOf("$$") + 2);
  });

  it("produces DisplayMathMark for $$ delimiters", () => {
    const nodes = findNodes("$$x$$", "DisplayMathMark");
    expect(nodes).toHaveLength(2);
  });
});

describe("both display syntaxes produce the same node type", () => {
  it("\\[x\\] and $$x$$ both produce DisplayMath", () => {
    const backslashNodes = findNodes("\\[x\\]", "DisplayMath");
    const dollarNodes = findNodes("$$x$$", "DisplayMath");
    expect(backslashNodes).toHaveLength(1);
    expect(dollarNodes).toHaveLength(1);
    expect(backslashNodes[0].name).toBe(dollarNodes[0].name);
  });
});

describe("$$ is not parsed as inline math", () => {
  it("$$x$$ produces DisplayMath, not InlineMath", () => {
    const inline = findNodes("$$x$$", "InlineMath");
    expect(inline).toHaveLength(0);
    const display = findNodes("$$x$$", "DisplayMath");
    expect(display).toHaveLength(1);
  });
});

describe("escaped backslash does NOT trigger display math", () => {
  it("\\\\[ does not parse as display math", () => {
    const text = "\\\\[x^2\\\\]";
    const displayMath = findNodes(text, "DisplayMath");
    expect(displayMath).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Labeled display math ($$ with {#eq:...})
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Labeled display math (\[ with {#eq:...})
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Equation label edge cases
// ---------------------------------------------------------------------------

/**
 * REGRESSION: stale currentLineEnd on early fence break.
 *
 * When display math scanning hits a fenced div closing fence (:::), it
 * breaks out of the while loop. Before the fix, `currentLineEnd` held the
 * value from the PREVIOUS iteration, so the unclosed DisplayMath node
 * extended past the ::: fence into the next block's territory. The fix
 * updates `currentLineEnd` to `cx.lineStart` before breaking so the
 * DisplayMath ends just before the fence line.
 */
describe("stale currentLineEnd on fence break (REGRESSION)", () => {
  /** Parse with fenced div + math + equation label extensions. */
  function parseFull(text: string): Array<{ name: string; from: number; to: number; text: string }> {
    const mdParser = parser.configure([mathExtension, equationLabelExtension, fencedDiv]);
    const tree = mdParser.parse(text);
    const nodes: Array<{ name: string; from: number; to: number; text: string }> = [];
    tree.iterate({
      enter(node) {
        nodes.push({ name: node.name, from: node.from, to: node.to, text: text.slice(node.from, node.to) });
      },
    });
    return nodes;
  }

  it("unclosed \\[ before ::: does not extend past the fence", () => {
    // Unclosed \[ inside a fenced div should end before the closing :::
    const text = [
      "::: {.theorem}",
      "\\[",
      "x^2",
      ":::",
    ].join("\n");
    const nodes = parseFull(text);
    const displayMath = nodes.filter((n) => n.name === "DisplayMath");
    expect(displayMath.length).toBeGreaterThanOrEqual(1);
    const dm = displayMath[0];
    // The DisplayMath should NOT extend past the ::: line
    const fenceLineStart = text.lastIndexOf(":::");
    expect(dm.to).toBeLessThanOrEqual(fenceLineStart);
  });

  it("unclosed $$ before ::: does not extend past the fence", () => {
    const text = [
      "::: {.theorem}",
      "$$",
      "x^2",
      ":::",
    ].join("\n");
    const nodes = parseFull(text);
    const displayMath = nodes.filter((n) => n.name === "DisplayMath");
    expect(displayMath.length).toBeGreaterThanOrEqual(1);
    const dm = displayMath[0];
    const fenceLineStart = text.lastIndexOf(":::");
    expect(dm.to).toBeLessThanOrEqual(fenceLineStart);
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

// ---------------------------------------------------------------------------
// REGRESSION: multi-line $$ closing with equation label not detected (#484)
//
// When $$ appears mid-line (e.g. \end{aligned}$$), the old startsWith/endsWith
// approach missed cases where $$ was followed by an equation label on the same
// line. The fix uses indexOf("$$") — same pattern as the \] parser.
// ---------------------------------------------------------------------------

describe("multi-line $$ closing with equation label (#484 REGRESSION)", () => {
  it("detects \\end{aligned}$$ {#eq:foo} as closing with label", () => {
    const text = "$$\n\\begin{aligned}\na &= b\n\\end{aligned}$$ {#eq:foo}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:foo}");

    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].to).toBe(text.length);
  });

  it("detects \\end{aligned}$$ without label", () => {
    const text = "$$\n\\begin{aligned}\na &= b\n\\end{aligned}$$";
    const display = findNodes(text, "DisplayMath");
    expect(display).toHaveLength(1);
    expect(display[0].from).toBe(0);
    expect(display[0].to).toBe(text.length);

    const marks = findNodes(text, "DisplayMathMark");
    expect(marks).toHaveLength(2);
  });

  it("detects mid-line $$ with label after content", () => {
    const text = "$$\nsome content$$ {#eq:bar}";
    const labels = findNodes(text, "EquationLabel");
    expect(labels).toHaveLength(1);
    expect(nodeText(text, labels[0])).toBe("{#eq:bar}");
  });
});
