import { describe, expect, it } from "vitest";

import { buildDocumentLabelGraph } from "../app/markdown/labels";
import { parseFrontmatter } from "../lib/frontmatter";
import { roundTripMarkdown } from "./markdown";
import { buildRenderIndex } from "./markdown/reference-index";

const FORMAT_FIXTURE = `---
title: Test Document
bibliography: refs.bib
numbering: global
math:
  \\R: "\\\\mathbb{R}"
  \\N: "\\\\mathbb{N}"
blocks:
  claim:
    title: Claim
    counter: theorem
---

# Introduction

## Background {-}

This paragraph has **bold text**, *italic text*, \`inline code\`, ~~strikethrough~~, ==highlighted== words.

Inline math: $e^{i\\pi} + 1 = 0$. Backslash inline: \\(x^2 + y^2\\).

$$
\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

$$
E = mc^2
$$ {#eq:einstein}

\\[
\\sum_{k=0}^n \\binom{n}{k} = 2^n
\\]

::: {#thm:main .theorem} Main Result
Every element of $\\R$ satisfies the property.
:::

::::: {.theorem} Nested Example
Statement.

:::: {.proof}
Nested proof.
::::
:::::

| Algorithm | Time |
|-----------|------|
| Quicksort | $O(n \\log n)$ |

- [ ] Unchecked task
- [x] Checked task

See [@thm:main] for the proof.

This has a footnote[^1].

[^1]: Footnote content with $x^2$.

::: {.include}
chapters/introduction.md
:::`;

const FORMAT_SEMANTIC_FIXTURE = [
  "---",
  "numbering: global",
  "blocks:",
  "  claim:",
  "    title: Claim",
  "    counter: theorem",
  "---",
  "",
  "# Format Section {#sec:format}",
  "",
  "Intro cites [@thm:format], [@claim:format], [@eq:format], [@tbl:format], and [@sec:format].",
  "",
  "$$",
  "x + y",
  "$$ {#eq:format}",
  "",
  '::: {#thm:format .theorem title="Attribute Title"} Trailing **Title**',
  "Statement with $x$ and a footnote[^fmt].",
  ":::",
  "",
  "::: {.claim #claim:format} Custom Claim",
  "Claim body.",
  ":::",
  "",
  "::: {.table #tbl:format} Running Times",
  "| Term | Value |",
  "|------|-------|",
  "| Math | $x$ and [@thm:format] |",
  ":::",
  "",
  "::: {.blockquote #quote:format}",
  "Quoted $y$ and [@sec:format].",
  ":::",
  "",
  "[^fmt]: Footnote with $z$.",
].join("\n");

describe("FORMAT.md carryover", () => {
  it("round-trips the representative format fixture exactly", () => {
    expect(roundTripMarkdown(FORMAT_FIXTURE)).toBe(FORMAT_FIXTURE);
  });

  it("round-trips the semantic parity fixture exactly", () => {
    expect(roundTripMarkdown(FORMAT_SEMANTIC_FIXTURE)).toBe(FORMAT_SEMANTIC_FIXTURE);
  });

  it("indexes FORMAT reference targets and render labels from the same syntax", () => {
    const graph = buildDocumentLabelGraph(FORMAT_SEMANTIC_FIXTURE);
    const definitions = new Map(graph.definitions.map((definition) => [definition.id, definition]));
    const renderIndex = buildRenderIndex(FORMAT_SEMANTIC_FIXTURE, parseFrontmatter(FORMAT_SEMANTIC_FIXTURE).config);

    expect(definitions.get("sec:format")).toMatchObject({
      kind: "heading",
      number: "1",
      title: "Format Section",
    });
    expect(definitions.get("eq:format")).toMatchObject({
      kind: "equation",
      text: "x + y",
    });
    expect(definitions.get("thm:format")).toMatchObject({
      blockType: "theorem",
      kind: "block",
      title: "Trailing **Title**",
    });
    expect(definitions.get("tbl:format")).toMatchObject({
      blockType: "table",
      kind: "block",
      title: "Running Times",
    });
    expect(definitions.get("claim:format")).toMatchObject({
      blockType: "claim",
      kind: "block",
      title: "Custom Claim",
    });

    expect(graph.referencesByTarget.get("sec:format")).toHaveLength(2);
    expect(graph.referencesByTarget.get("thm:format")).toHaveLength(2);
    expect(graph.referencesByTarget.get("claim:format")).toHaveLength(1);
    expect(graph.referencesByTarget.get("eq:format")).toHaveLength(1);
    expect(graph.referencesByTarget.get("tbl:format")).toHaveLength(1);

    expect(renderIndex.references.get("sec:format")).toMatchObject({
      kind: "heading",
      label: "Section 1",
      shortLabel: "1",
    });
    expect(renderIndex.references.get("eq:format")).toMatchObject({
      kind: "equation",
      label: "Equation (1)",
      shortLabel: "(1)",
    });
    expect(renderIndex.references.get("thm:format")).toMatchObject({
      blockType: "theorem",
      kind: "block",
      label: "Theorem 1",
    });
    expect(renderIndex.references.get("claim:format")).toMatchObject({
      blockType: "claim",
      kind: "block",
      label: "Claim 2",
    });
    expect(renderIndex.references.get("tbl:format")).toMatchObject({
      blockType: "table",
      kind: "block",
      label: "Table 3",
    });
    expect(renderIndex.references.get("quote:format")).toMatchObject({
      blockType: "blockquote",
      kind: "block",
      label: "Blockquote",
    });
    expect(renderIndex.footnotes.get("fmt")).toBe(1);
  });

  it.each([
    {
      name: "single-line fenced div",
      markdown: "::: {.corollary} Every continuous function on a closed interval is bounded. :::",
    },
    {
      name: "title attribute plus trailing title",
      markdown: [
        '::: {#thm:attr .theorem title="Attribute Title"} Trailing Title',
        "Statement.",
        ":::",
      ].join("\n"),
    },
    {
      name: "compatibility theorem opener",
      markdown: [
        "::: Theorem Bolzano-Weierstrass",
        "Every bounded sequence in $\\R$ has a convergent subsequence.",
        ":::",
      ].join("\n"),
    },
    {
      name: "blockquote fenced div compatibility",
      markdown: [
        "::: {.blockquote}",
        "Mathematics is the queen of the sciences.",
        ":::",
      ].join("\n"),
    },
    {
      name: "pandoc grid table compatibility",
      markdown: [
        "+----------+----------+",
        "| Left     | Right    |",
        "+==========+==========+",
        "| $x$      | [@ref]   |",
        "+----------+----------+",
      ].join("\n"),
      expected: [
        "+----------+----------+",
        "| Left     | Right    |",
        "+==+==+",
        "| $x$      | [@ref]   |",
        "+----------+----------+",
      ].join("\n"),
    },
  ])("round-trips $name", ({ markdown, expected }) => {
    expect(roundTripMarkdown(markdown)).toBe(expected ?? markdown);
  });
});
