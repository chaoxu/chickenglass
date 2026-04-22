import { describe, expect, it } from "vitest";

import { extractMarkdownBlocks, extractMarkdownEquations } from "./label-parser";

describe("extractMarkdownEquations", () => {
  it("extracts labels from canonical pandoc-crossref display math attributes", () => {
    const doc = [
      "Before",
      "$$",
      "x + y",
      "$$ {#eq:sum}",
      "After",
    ].join("\n");

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 7,
        id: "eq:sum",
        labelFrom: 21,
        labelTo: 27,
        text: "x + y",
        to: 28,
      },
    ]);
  });

  it("does not create canonical labels from raw LaTeX equation labels", () => {
    const doc = [
      "Before",
      "\\begin{equation}\\label{eq:sum}",
      "x + y",
      "\\end{equation}",
      "After",
    ].join("\n");

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 7,
        id: undefined,
        labelFrom: undefined,
        labelTo: undefined,
        text: "x + y",
        to: 58,
      },
    ]);
  });

  it("keeps unlabeled display math as equation blocks without definitions", () => {
    const doc = "$$\nx + y\n$$";

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 0,
        id: undefined,
        labelFrom: undefined,
        labelTo: undefined,
        text: "x + y",
        to: 11,
      },
    ]);
  });

  it("extracts single-line display-math attribute labels", () => {
    expect(extractMarkdownEquations("$$x + y$$ {#eq:sum}")).toEqual([
      {
        from: 0,
        id: "eq:sum",
        labelFrom: 12,
        labelTo: 18,
        text: "x + y",
        to: 19,
      },
    ]);
  });

  it("extracts labels from backslash display math attributes", () => {
    const doc = [
      "Before",
      "\\[",
      "x + y",
      "\\] {#eq:sum}",
      "After",
    ].join("\n");

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: doc.indexOf("\\["),
        id: "eq:sum",
        labelFrom: doc.indexOf("eq:sum"),
        labelTo: doc.indexOf("eq:sum") + "eq:sum".length,
        text: "x + y",
        to: doc.indexOf("\nAfter"),
      },
    ]);
  });

  it("extracts single-line backslash display-math attribute labels", () => {
    const doc = "\\[x + y\\] {#eq:sum}";

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 0,
        id: "eq:sum",
        labelFrom: doc.indexOf("eq:sum"),
        labelTo: doc.indexOf("eq:sum") + "eq:sum".length,
        text: "x + y",
        to: doc.length,
      },
    ]);
  });

  it("ignores non-equation display-math attributes", () => {
    expect(extractMarkdownEquations("$$x + y$$ {#fig:plot}")).toEqual([
      {
        from: 0,
        id: undefined,
        labelFrom: undefined,
        labelTo: undefined,
        text: "x + y",
        to: 21,
      },
    ]);
    expect(extractMarkdownEquations("$$x + y$$ {#eq:eq:bad}")).toEqual([
      {
        from: 0,
        id: undefined,
        labelFrom: undefined,
        labelTo: undefined,
        text: "x + y",
        to: 22,
      },
    ]);
  });

  it("uses the trailing label span even when the equation body contains the same text", () => {
    const doc = [
      "$$",
      "\\text{#eq:sum}",
      "$$ {#eq:sum}",
    ].join("\n");

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 0,
        id: "eq:sum",
        labelFrom: 23,
        labelTo: 29,
        text: "\\text{#eq:sum}",
        to: 30,
      },
    ]);
  });

  it("ignores malformed raw equations that the block scanner rejects", () => {
    expect(extractMarkdownEquations("\\begin{equation}\\label{eq:nope}\nx + y")).toEqual([]);
  });

  it("ignores non-canonical fenced-div blocks", () => {
    const doc = [
      "::: {.theorem #thm:a} Legacy title",
      "Body",
      ":::",
      "",
      '::: {.lemma #lem:b title="Canonical"}',
      "Body",
      ":::",
    ].join("\n");

    expect(extractMarkdownBlocks(doc).map((block) => block.id)).toEqual(["lem:b"]);
  });
});
