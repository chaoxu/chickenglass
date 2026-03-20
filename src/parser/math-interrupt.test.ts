import { describe, test, expect } from "vitest";
import { parser } from "@lezer/markdown";
import { mathExtension } from "./math-backslash";
import { fencedDiv } from "./fenced-div";
import { removeIndentedCode } from "./remove-indented-code";

const mathParser = parser.configure([removeIndentedCode, mathExtension]);

/** Parser with both math and fenced divs for integration tests. */
const fullParser = parser.configure([
  removeIndentedCode,
  mathExtension,
  fencedDiv,
]);

function hasNode(doc: string, nodeName: string): boolean {
  const tree = mathParser.parse(doc);
  let found = false;
  tree.iterate({
    enter(node) {
      if (node.name === nodeName) found = true;
    },
  });
  return found;
}

function hasNodeFull(doc: string, nodeName: string): boolean {
  const tree = fullParser.parse(doc);
  let found = false;
  tree.iterate({
    enter(node) {
      if (node.name === nodeName) found = true;
    },
  });
  return found;
}

function countNodes(doc: string, nodeName: string): number {
  const tree = mathParser.parse(doc);
  let count = 0;
  tree.iterate({
    enter(node) {
      if (node.name === nodeName) count++;
    },
  });
  return count;
}


test("\\[ with blank line produces DisplayMath", () => {
  expect(hasNode("Text before\n\n\\[\nx^2\n\\]\n", "DisplayMath")).toBe(true);
});

test("\\[ without blank line produces DisplayMath", () => {
  expect(hasNode("Text before\n\\[\nx^2\n\\]\n", "DisplayMath")).toBe(true);
});

test("$$ without blank line produces DisplayMath", () => {
  expect(hasNode("Text before\n$$\nx^2\n$$\n", "DisplayMath")).toBe(true);
});

test("$$ with blank line produces DisplayMath", () => {
  expect(hasNode("Text before\n\n$$\nx^2\n$$\n", "DisplayMath")).toBe(true);
});

test("\\[ inside list item with indented continuation", () => {
  expect(hasNode("1. item\n2. \\[\n   x^2\n   \\]\n", "DisplayMath")).toBe(true);
});

test("\\[ on continuation line of list item produces DisplayMath", () => {
  expect(hasNode("1. item\n2. text\n   \\[\n   x^2\n   \\]\n", "DisplayMath")).toBe(true);
});

test("$$ inside list item with indented continuation", () => {
  expect(hasNode("1. item\n2. $$\n   x^2\n   $$\n", "DisplayMath")).toBe(true);
});

// ---------------------------------------------------------------------------
// Display math inside list items (#210)
// ---------------------------------------------------------------------------

describe("display math inside ordered list items (#210)", () => {
  test("$$ on same line as list marker", () => {
    const doc = "1. $$\nx^2\n$$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("$$ on continuation line of list item", () => {
    const doc = "1. text\n   $$\n   x^2\n   $$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\[ on same line as list marker", () => {
    const doc = "1. \\[\n   x^2\n   \\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("nested list with $$ display math", () => {
    const doc = "1. outer\n   1. $$\n      x^2\n      $$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("$$ after paragraph in list item (loose list)", () => {
    const doc = "1. paragraph\n\n   $$\n   x^2\n   $$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\[ after paragraph in list item (loose list)", () => {
    const doc = "1. paragraph\n\n   \\[\n   x^2\n   \\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("nested list with \\[ display math", () => {
    const doc = "1. outer\n   1. \\[\n      x^2\n      \\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });
});

describe("display math inside unordered list items (#210)", () => {
  test("$$ on same line as unordered list marker", () => {
    const doc = "- $$\nx^2\n$$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("$$ on continuation line of unordered list item", () => {
    const doc = "- text\n  $$\n  x^2\n  $$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\[ on same line as unordered list marker", () => {
    const doc = "- \\[\n  x^2\n  \\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("$$ after paragraph in unordered list (loose list)", () => {
    const doc = "- paragraph\n\n  $$\n  x^2\n  $$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\[ after paragraph in unordered list (loose list)", () => {
    const doc = "- paragraph\n\n  \\[\n  x^2\n  \\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge case 1: \[...\] inside blockquotes
// ---------------------------------------------------------------------------

describe("\\[...\\] inside blockquotes", () => {
  test("multi-line \\[...\\] in blockquote produces DisplayMath", () => {
    const doc = "> \\[\n> x^2\n> \\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("single-line \\[...\\] in blockquote produces DisplayMath", () => {
    const doc = "> \\[x^2\\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("$$ in blockquote produces DisplayMath", () => {
    const doc = "> $$\n> x^2\n> $$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge case 2: \[...\] with trailing punctuation
// ---------------------------------------------------------------------------

describe("\\] with trailing punctuation", () => {
  test("\\]. after display math still finds closing \\]", () => {
    // The \\] should be detected even if followed by a period on the same line
    // Note: the block parser looks for \\] anywhere in the line
    const doc = "\\[\nx^2\n\\].";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\], after display math still finds closing \\]", () => {
    const doc = "\\[\nx^2\n\\],";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\]; after display math still finds closing \\]", () => {
    const doc = "\\[\nx^2\n\\];";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("single-line \\[x\\]. finds DisplayMath", () => {
    const doc = "\\[x^2\\].";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge case 3: nested fenced divs inside list items
// ---------------------------------------------------------------------------

describe("fenced divs inside list items", () => {
  test("fenced div at start of list item produces FencedDiv", () => {
    const doc = "1. ::: {.theorem}\n   content\n   :::";
    expect(hasNodeFull(doc, "FencedDiv")).toBe(true);
  });

  test("fenced div with blank line after list marker", () => {
    const doc = "- text\n\n  ::: {.theorem}\n  content\n  :::";
    expect(hasNodeFull(doc, "FencedDiv")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge case 5: \begin{align*} inside $$
// ---------------------------------------------------------------------------

describe("\\begin{align*} inside $$", () => {
  test("$$ with \\begin{align*} produces DisplayMath", () => {
    const doc = "$$\n\\begin{align*}\nx &= y\n\\end{align*}\n$$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("$$ with \\begin{align} produces DisplayMath", () => {
    const doc = "$$\n\\begin{align}\nx &= y \\\\\nz &= w\n\\end{align}\n$$";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });

  test("\\[ with \\begin{align*} produces DisplayMath", () => {
    const doc = "\\[\n\\begin{align*}\nx &= y\n\\end{align*}\n\\]";
    expect(hasNode(doc, "DisplayMath")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge case 6: mixed $ and \( math in same document
// ---------------------------------------------------------------------------

describe("mixed $ and \\( math syntaxes", () => {
  test("both $...$ and \\(...\\) produce InlineMath in same doc", () => {
    const doc = "We have $x^2$ and also \\(y^2\\) in one line.";
    expect(countNodes(doc, "InlineMath")).toBe(2);
  });

  test("both $$...$$ and \\[...\\] produce DisplayMath in same doc", () => {
    const doc = "$$\na = b\n$$\n\n\\[\nc = d\n\\]";
    expect(countNodes(doc, "DisplayMath")).toBe(2);
  });

  test("inline $ and display \\[ coexist without interference", () => {
    const doc = "Let $x = 1$.\n\n\\[\nx^2 = 1\n\\]\n\nThen \\(y = 2\\).";
    expect(countNodes(doc, "InlineMath")).toBe(2);
    expect(countNodes(doc, "DisplayMath")).toBe(1);
  });

  test("display $$ and inline \\( coexist without interference", () => {
    const doc = "$$\na + b\n$$\n\nWe see \\(c\\) and $d$.";
    expect(countNodes(doc, "InlineMath")).toBe(2);
    expect(countNodes(doc, "DisplayMath")).toBe(1);
  });
});
