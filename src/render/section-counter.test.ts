import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import type { Decoration } from "@codemirror/view";
import { buildSectionDecorations } from "./section-counter";
import { documentSemanticsField } from "../semantics/codemirror-source";

/** Create an EditorState with the markdown parser and a given document. */
function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown(), documentSemanticsField],
  });
}

/** Extract section numbers from a DecorationSet as an array of strings. */
function extractNumbers(state: EditorState): string[] {
  const decos = buildSectionDecorations(state);
  const numbers: string[] = [];
  const iter = decos.iter();
  while (iter.value) {
    const attrs = (iter.value as Decoration & { attrs?: Record<string, string> }).spec?.attributes;
    if (attrs?.["data-section-number"]) {
      numbers.push(attrs["data-section-number"]);
    }
    iter.next();
  }
  return numbers;
}

describe("buildSectionDecorations", () => {
  it("numbers sequential top-level headings", () => {
    const doc = [
      "# One",
      "",
      "# Two",
      "",
      "# Three",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual(["1", "2", "3"]);
  });

  it("numbers more than 7 top-level headings correctly", () => {
    // Regression test for issue #86: section numbers stopped at 7
    const doc = [
      "# Introduction",
      "",
      "# Math",
      "",
      "# Theorems & Proofs",
      "",
      "# References",
      "",
      "# Lists",
      "",
      "# Tables",
      "",
      "# Footnotes",
      "",
      "# Code",
      "",
      "# Blockquote",
      "",
      "# Background",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    ]);
  });

  it("assigns hierarchical numbers to nested headings", () => {
    const doc = [
      "# Chapter",
      "",
      "## Section A",
      "",
      "## Section B",
      "",
      "### Subsection B.1",
      "",
      "# Chapter 2",
      "",
      "## Section C",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual([
      "1", "1.1", "1.2", "1.2.1", "2", "2.1",
    ]);
  });

  it("resets deeper counters when a shallower heading appears", () => {
    const doc = [
      "# A",
      "",
      "## A.1",
      "",
      "### A.1.1",
      "",
      "# B",
      "",
      "## B.1",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual([
      "1", "1.1", "1.1.1", "2", "2.1",
    ]);
  });

  it("returns empty for a document with no headings", () => {
    const doc = "Hello world\n\nSome text.";
    expect(extractNumbers(createState(doc))).toEqual([]);
  });

  it("returns empty for an empty document", () => {
    expect(extractNumbers(createState(""))).toEqual([]);
  });

  it("skips numbering for headings with {-} attribute", () => {
    const doc = [
      "# Intro",
      "",
      "# Acknowledgments {-}",
      "",
      "# Methods",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual(["1", "2"]);
  });

  it("skips numbering for headings with {.unnumbered} attribute", () => {
    const doc = [
      "# Intro",
      "",
      "# Acknowledgments {.unnumbered}",
      "",
      "# Methods",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual(["1", "2"]);
  });

  it("skips unnumbered headings at any level", () => {
    const doc = [
      "# Chapter",
      "",
      "## Aside {-}",
      "",
      "## Real Section",
      "",
      "### Deep Aside {.unnumbered}",
      "",
      "### Real Subsection",
    ].join("\n");
    expect(extractNumbers(createState(doc))).toEqual([
      "1", "1.1", "1.1.1",
    ]);
  });

  it("does not affect counter state for unnumbered headings", () => {
    const doc = [
      "# One",
      "",
      "## Sub A",
      "",
      "## Unnumbered {-}",
      "",
      "## Sub B",
      "",
      "# Two",
    ].join("\n");
    // Sub B should be 1.2, not 1.3 — the unnumbered heading doesn't increment
    expect(extractNumbers(createState(doc))).toEqual([
      "1", "1.1", "1.2", "2",
    ]);
  });
});
