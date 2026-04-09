import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { NODE } from "../constants/node-types";
import { markdownExtensions } from "../parser";
import {
  findAncestor,
  findAncestorByName,
  isDisplayMath,
  isFencedCode,
  isFencedDiv,
  isHeading,
  isInlineMath,
  isMath,
} from "./syntax-tree-helpers";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function findFirstNode(state: EditorState, name: string): SyntaxNode | null {
  let match: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== name || match) {
        return;
      }
      match = node.node;
    },
  });
  return match;
}

describe("findAncestor", () => {
  it("includes the starting node when it already matches", () => {
    const state = createState("```js\ncode\n```");
    const node = findFirstNode(state, NODE.FencedCode);

    expect(node).not.toBeNull();
    expect(findAncestor(node, isFencedCode)).toBe(node);
  });

  it("walks upward until it finds the requested ancestor", () => {
    const doc = [
      "::: {.theorem}",
      "Outer",
      "::: {.proof}",
      "Inner",
      ":::",
      ":::",
    ].join("\n");
    const state = createState(doc);
    const node = syntaxTree(state).resolveInner(doc.indexOf("Inner"), 1);

    const ancestor = findAncestor(node, isFencedDiv);

    expect(ancestor).not.toBeNull();
    expect(ancestor?.name).toBe(NODE.FencedDiv);
    expect(doc.slice(ancestor?.from ?? 0, ancestor?.to ?? 0)).toContain("Inner");
  });
});

describe("findAncestorByName", () => {
  it("finds ancestors by node type name", () => {
    const state = createState("```js\ncode\n```");
    const node = syntaxTree(state).resolveInner(5, 1);

    const ancestor = findAncestorByName(node, NODE.FencedCode);

    expect(ancestor).not.toBeNull();
    expect(ancestor?.name).toBe(NODE.FencedCode);
  });
});

describe("node guards", () => {
  it("recognizes heading nodes", () => {
    expect(isHeading({ name: NODE.ATXHeading3 })).toBe(true);
    expect(isHeading({ name: NODE.SetextHeading2 })).toBe(true);
    expect(isHeading({ name: NODE.FencedDiv })).toBe(false);
  });

  it("recognizes math nodes", () => {
    expect(isInlineMath({ name: NODE.InlineMath })).toBe(true);
    expect(isDisplayMath({ name: NODE.DisplayMath })).toBe(true);
    expect(isMath({ name: NODE.InlineMath })).toBe(true);
    expect(isMath({ name: NODE.DisplayMath })).toBe(true);
    expect(isMath({ name: NODE.FencedCode })).toBe(false);
  });
});
