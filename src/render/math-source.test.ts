import { describe, expect, it } from "vitest";
import { parser as lezerParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { equationLabelExtension } from "../parser/equation-label";
import { mathExtension } from "../parser/math-backslash";
import {
  _snapToTokenBoundary,
  getDisplayMathContentEnd,
  stripMathDelimiters,
} from "./math-source";

function findDisplayMathSyntaxNode(text: string): SyntaxNode {
  const configured = lezerParser.configure([mathExtension, equationLabelExtension]);
  const tree = configured.parse(text);
  let found: SyntaxNode | undefined;
  tree.iterate({
    enter(node) {
      if (node.name === "DisplayMath" && !found) {
        found = node.node;
        return false;
      }
    },
  });
  if (!found) throw new Error("DisplayMath node not found in parsed tree");
  return found;
}

describe("stripMathDelimiters", () => {
  it("strips $$ delimiters when contentTo slices at closing $$", () => {
    expect(stripMathDelimiters("$$x^2$$ {#eq:foo}", true, 7)).toBe("x^2");
  });

  it("strips \\[\\] delimiters when contentTo slices at closing \\]", () => {
    expect(stripMathDelimiters("\\[x^2\\] {#eq:foo}", true, 7)).toBe("x^2");
  });

  it("strips multi-line $$ delimiters with contentTo", () => {
    const raw = "$$\nx^2\n$$ {#eq:foo}";
    expect(stripMathDelimiters(raw, true, 9)).toBe("\nx^2\n");
  });

  it("handles plain display math without contentTo", () => {
    expect(stripMathDelimiters("$$x^2$$", true)).toBe("x^2");
    expect(stripMathDelimiters("\\[x^2\\]", true)).toBe("x^2");
  });
});

describe("getDisplayMathContentEnd", () => {
  it("returns offset for labeled $$ display math", () => {
    const node = findDisplayMathSyntaxNode("$$x^2$$ {#eq:foo}");
    expect(getDisplayMathContentEnd(node)).toBe(7);
  });

  it("returns offset for labeled \\[\\] display math", () => {
    const node = findDisplayMathSyntaxNode("\\[x^2\\] {#eq:foo}");
    expect(getDisplayMathContentEnd(node)).toBe(7);
  });

  it("returns undefined for unlabeled display math", () => {
    const node = findDisplayMathSyntaxNode("$$x^2$$");
    expect(getDisplayMathContentEnd(node)).toBeUndefined();
  });

  it("returns offset for multi-line labeled display math", () => {
    const node = findDisplayMathSyntaxNode("$$\nx^2\n$$ {#eq:bar}");
    expect(getDisplayMathContentEnd(node)).toBe(9);
  });
});

describe("_snapToTokenBoundary", () => {
  it("snaps to the start of a backslash command", () => {
    const latex = "\\alpha + \\beta";
    expect(_snapToTokenBoundary(latex, 10, 12)).toBe(10);
    expect(_snapToTokenBoundary(latex, 10, 15)).toBe(16);
  });

  it("snaps to single-char tokens", () => {
    const latex = "x+y";
    expect(_snapToTokenBoundary(latex, 0, 0)).toBe(0);
    expect(_snapToTokenBoundary(latex, 0, 1)).toBe(1);
    expect(_snapToTokenBoundary(latex, 0, 2)).toBe(2);
  });

  it("handles backslash-symbol commands like \\,", () => {
    const latex = "a\\,b";
    expect(_snapToTokenBoundary(latex, 0, 1)).toBe(1);
    expect(_snapToTokenBoundary(latex, 0, 2)).toBe(1);
  });

  it("snaps to end of expression", () => {
    expect(_snapToTokenBoundary("xy", 100, 102)).toBe(102);
  });
});
