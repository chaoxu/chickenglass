import { describe, expect, it } from "vitest";

import { extractMarkdownEquations } from "./label-parser";

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

  it("continues to read legacy raw LaTeX equation labels", () => {
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
        id: "eq:sum",
        labelFrom: 30,
        labelTo: 36,
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

  it("ignores malformed raw equations that the block scanner rejects", () => {
    expect(extractMarkdownEquations("\\begin{equation}\\label{eq:nope}\nx + y")).toEqual([]);
  });
});
