import { test, expect } from "vitest";
import { parser } from "@lezer/markdown";
import { mathExtension } from "./math-backslash";
import { removeIndentedCode } from "./remove-indented-code";

const mathParser = parser.configure([removeIndentedCode, mathExtension]);

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
