import { describe, expect, it } from "vitest";
import { parser } from "@lezer/markdown";
import { tableExtension } from "./table";
import { mathExtension } from "./math-backslash";
import { equationLabelExtension } from "./equation-label";

const mdParser = parser.configure([mathExtension, equationLabelExtension, tableExtension]);

function parseNodes(text: string): Array<{ name: string; from: number; to: number }> {
  const tree = mdParser.parse(text);
  const nodes: Array<{ name: string; from: number; to: number }> = [];
  tree.iterate({ enter(node) { nodes.push({ name: node.name, from: node.from, to: node.to }); } });
  return nodes;
}

function findNodes(text: string, name: string) {
  return parseNodes(text).filter((n) => n.name === name);
}

/** Return the document text at a node's range. */
function nodeText(doc: string, node: { from: number; to: number }) {
  return doc.slice(node.from, node.to);
}

const SIMPLE = "| A | B |\n| --- | --- |\n| 1 | 2 |";

describe("tableExtension — basic structure", () => {
  it("produces a Table node", () => {
    expect(findNodes(SIMPLE, "Table")).toHaveLength(1);
  });

  it("produces a TableHeader, one TableDelimiter, and one TableRow", () => {
    const nodes = parseNodes(SIMPLE);
    expect(nodes.filter((n) => n.name === "TableHeader")).toHaveLength(1);
    // TableDelimiter covers both the separator row node and per-cell pipe tokens
    expect(nodes.filter((n) => n.name === "TableDelimiter").length).toBeGreaterThan(0);
    expect(nodes.filter((n) => n.name === "TableRow")).toHaveLength(1);
  });

  it("produces correct TableCell count per row", () => {
    const cells = findNodes(SIMPLE, "TableCell");
    // 2 header cells + 2 data cells = 4
    expect(cells).toHaveLength(4);
  });

  it("accepts a Pandoc table with more delimiter columns than header cells", () => {
    const doc = "| A | B |\n| --- | --- | --- |\n| 1 | 2 | 3 |";

    expect(findNodes(doc, "Table")).toHaveLength(1);
  });

  it("accepts a Pandoc table with fewer delimiter columns than header cells", () => {
    const doc = "| A | B | C |\n| --- | --- |\n| 1 | 2 | 3 |";

    expect(findNodes(doc, "Table")).toHaveLength(1);
  });
});

describe("tableExtension — pipes inside $…$ math", () => {
  const doc = "| A | B |\n| --- | --- |\n| $O(r \\cdot |E| \\cdot T)$ | No |";

  it("produces exactly one data TableRow (not split on math-internal pipes)", () => {
    expect(findNodes(doc, "TableRow")).toHaveLength(1);
  });

  it("produces 2 data cells (not 4)", () => {
    const cells = findNodes(doc, "TableCell");
    // 2 header + 2 data = 4 total
    expect(cells).toHaveLength(4);
  });

  it("the first data cell spans the entire math expression including internal pipes", () => {
    const cells = findNodes(doc, "TableCell");
    // header cells are first; data cells are last 2
    const dataCell0 = cells[2];
    const text = nodeText(doc, dataCell0).trim();
    expect(text).toBe("$O(r \\cdot |E| \\cdot T)$");
  });
});

describe("tableExtension — pipes inside \\(…\\) math", () => {
  const doc = "| A | B |\n| --- | --- |\n| \\(a \\| b\\) | No |";

  it("produces 2 data cells", () => {
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(4); // 2 header + 2 data
  });

  it("keeps escaped pipes inside the same InlineMath node", () => {
    const mathNodes = findNodes(doc, "InlineMath");
    expect(mathNodes).toHaveLength(1);
    expect(nodeText(doc, mathNodes[0])).toBe("\\(a \\| b\\)");
  });
});

describe("tableExtension — pipes inside backtick code spans", () => {
  const doc = "| A | B |\n| --- | --- |\n| `a | b` | No |";

  it("produces 2 data cells (pipe inside code is not a separator)", () => {
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(4); // 2 header + 2 data
  });

  it("the first data cell spans the full code span", () => {
    const cells = findNodes(doc, "TableCell");
    const dataCell0 = cells[2];
    const text = nodeText(doc, dataCell0).trim();
    expect(text).toBe("`a | b`");
  });
});

describe("tableExtension — InlineMath nodes inside cells", () => {
  it("produces InlineMath nodes for math inside table cells", () => {
    const doc = "| A |\n| --- |\n| $x^2$ |";
    expect(findNodes(doc, "InlineMath")).toHaveLength(1);
  });

  it("produces InlineMath for the full math expression when it contains pipes", () => {
    const doc = "| A | B |\n| --- | --- |\n| $a | b$ | c |";
    const mathNodes = findNodes(doc, "InlineMath");
    expect(mathNodes).toHaveLength(1);
    expect(nodeText(doc, mathNodes[0])).toBe("$a | b$");
  });

  it("keeps a trailing extra $ literal without collapsing the next math cell", () => {
    const doc = [
      "| Name | Time | Space |",
      "| --- | --- | --- |",
      "| Quicksort | $O(n \\log n)$$ | $O(\\log n)$ |",
    ].join("\n");
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(6);
    expect(nodeText(doc, cells[3]).trim()).toBe("Quicksort");
    expect(nodeText(doc, cells[4]).trim()).toBe("$O(n \\log n)$$");
    expect(nodeText(doc, cells[5]).trim()).toBe("$O(\\log n)$");
    expect(findNodes(doc, "InlineMath")).toHaveLength(2);
  });
});

describe("tableExtension — incomplete inline spans inside cells", () => {
  it("treats an unmatched $ as literal cell text without hiding separators", () => {
    const doc = "| A | B |\n| --- | --- |\n| $a | c |";
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(4);
    expect(nodeText(doc, cells[2]).trim()).toBe("$a");
    expect(findNodes(doc, "InlineMath")).toHaveLength(0);
  });

  it("treats an unmatched \\( as literal cell text without hiding separators", () => {
    const doc = "| A | B |\n| --- | --- |\n| \\(a | c |";
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(4);
    expect(nodeText(doc, cells[2]).trim()).toBe("\\(a");
    expect(findNodes(doc, "InlineMath")).toHaveLength(0);
  });

  it("does not let \\(...\\) consume a later cell's closing delimiter", () => {
    const doc = [
      "| A | B | C | D |",
      "| --- | --- | --- | --- |",
      "| row | \\(x | \\) y | z |",
    ].join("\n");
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(8);
    expect(nodeText(doc, cells[4]).trim()).toBe("row");
    expect(nodeText(doc, cells[5]).trim()).toBe("\\(x");
    expect(nodeText(doc, cells[6]).trim()).toBe("\\) y");
    expect(nodeText(doc, cells[7]).trim()).toBe("z");
    expect(findNodes(doc, "InlineMath")).toHaveLength(0);
  });

  it("does not let \\(...\\) consume a later cell's closing delimiter without padding spaces", () => {
    const doc = [
      "| A | B | C | D |",
      "| --- | --- | --- | --- |",
      "| row | \\(x|\\) y | z |",
    ].join("\n");
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(8);
    expect(nodeText(doc, cells[4]).trim()).toBe("row");
    expect(nodeText(doc, cells[5]).trim()).toBe("\\(x");
    expect(nodeText(doc, cells[6]).trim()).toBe("\\) y");
    expect(nodeText(doc, cells[7]).trim()).toBe("z");
    expect(findNodes(doc, "InlineMath")).toHaveLength(0);
  });

  it("does not let \\(...\\) consume text from the next cell before a later closing delimiter", () => {
    const doc = [
      "| A | B | C | D |",
      "| --- | --- | --- | --- |",
      "| row | \\(x | text \\) y | z |",
    ].join("\n");
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(8);
    expect(nodeText(doc, cells[4]).trim()).toBe("row");
    expect(nodeText(doc, cells[5]).trim()).toBe("\\(x");
    expect(nodeText(doc, cells[6]).trim()).toBe("text \\) y");
    expect(nodeText(doc, cells[7]).trim()).toBe("z");
    expect(findNodes(doc, "InlineMath")).toHaveLength(0);
  });

  it("does not open DisplayMath for $$ inside a table cell", () => {
    const doc = "| A | B |\n| --- | --- |\n| $$ | c |";
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(4);
    expect(nodeText(doc, cells[2]).trim()).toBe("$$");
    expect(findNodes(doc, "DisplayMath")).toHaveLength(0);
  });

  it("treats an unmatched backtick as literal cell text without hiding separators", () => {
    const doc = "| A | B |\n| --- | --- |\n| `a | c |";
    const cells = findNodes(doc, "TableCell");
    expect(cells).toHaveLength(4);
    expect(nodeText(doc, cells[2]).trim()).toBe("`a");
  });
});

describe("tableExtension — delimiter row validation", () => {
  it("rejects a delimiter row with trailing spaces and no final pipe", () => {
    const doc = "| A | B |\n| --- | ---  \n| 1 | 2 |";
    expect(findNodes(doc, "Table")).toHaveLength(0);
  });

  it("rejects a delimiter row without outer pipes when trailing spaces follow the last column", () => {
    const doc = "A | B\n--- | ---  \n1 | 2";
    expect(findNodes(doc, "Table")).toHaveLength(0);
  });

  it("still accepts a delimiter row without outer pipes when it ends at the last dash", () => {
    const doc = "A | B\n--- | ---\n1 | 2";
    expect(findNodes(doc, "Table")).toHaveLength(1);
  });
});
