import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import { ParagraphNode, TextNode, $getRoot, $getSelection, $isRangeSelection } from "lexical";

import { getMarkdownExpansionCandidate } from "./markdown-expansion-plugin";

function getCandidateFromLines(lines: readonly string[], paragraphIndex: number) {
  const editor = createHeadlessEditor({
    namespace: "coflat-markdown-expansion-test",
    nodes: [ParagraphNode, TextNode],
    onError(error) {
      throw error;
    },
  });

  let candidate = null;

  editor.update(() => {
    const root = $getRoot();
    for (const line of lines) {
      const paragraph = new ParagraphNode();
      if (line.length > 0) {
        paragraph.append(new TextNode(line));
      }
      root.append(paragraph);
    }

    const paragraph = root.getChildAtIndex(paragraphIndex);
    if (!paragraph) {
      throw new Error(`missing paragraph at index ${paragraphIndex}`);
    }

    paragraph.selectEnd();
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      throw new Error("expected range selection");
    }
    candidate = getMarkdownExpansionCandidate(selection);
  }, { discrete: true });

  return candidate;
}

describe("getMarkdownExpansionCandidate", () => {
  it("creates frontmatter from a top-level --- opener", () => {
    expect(getCandidateFromLines(["---"], 0)).toMatchObject({
      focusTarget: "frontmatter",
      raw: "---\ntitle: \n---",
      variant: "frontmatter",
    });
  });

  it("creates display math from a $$ line", () => {
    expect(getCandidateFromLines(["$$"], 0)).toMatchObject({
      focusTarget: "display-math",
      raw: "$$\n\n$$",
      variant: "display-math",
    });
  });

  it("creates theorem blocks from a fenced div opener", () => {
    expect(getCandidateFromLines(['::: {.theorem title="Main Result"}'], 0)).toMatchObject({
      focusTarget: "block-body",
      raw: '::: {.theorem title="Main Result"}\n\n:::',
      variant: "fenced-div",
    });
  });

  it("treats unknown custom openers as generic fenced divs", () => {
    expect(getCandidateFromLines(["::: {.custom-note}"], 0)).toMatchObject({
      focusTarget: "block-body",
      raw: "::: {.custom-note}\n\n:::",
      variant: "fenced-div",
    });
  });

  it("does not expand a bare fenced-div close marker", () => {
    expect(getCandidateFromLines([":::"], 0)).toBeNull();
  });

  it("creates image and footnote blocks through shared block-scanner syntax", () => {
    expect(getCandidateFromLines(["![Alt](figure.png)"], 0)).toMatchObject({
      raw: "![Alt](figure.png)",
      variant: "image",
    });
    expect(getCandidateFromLines(["[^main]: "], 0)).toMatchObject({
      focusTarget: "footnote-body",
      raw: "[^main]: ",
      variant: "footnote-definition",
    });
  });

  it("creates a table from a header and divider row", () => {
    expect(getCandidateFromLines(["| A | B |", "| --- | --- |"], 1)).toMatchObject({
      focusTarget: "table-cell",
      raw: "| A | B |\n| --- | --- |\n|  |  |",
      variant: "table",
    });
  });
});
