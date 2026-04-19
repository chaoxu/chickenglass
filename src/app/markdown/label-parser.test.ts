import { describe, expect, it } from "vitest";

import { extractMarkdownEquations } from "./label-parser";

describe("extractMarkdownEquations", () => {
  it("uses shared display-math parsing for single-line dollar equations with labels", () => {
    const doc = "Before\n$$x + y$$ {#eq:sum}\nAfter";

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 7,
        id: "eq:sum",
        labelFrom: 19,
        labelTo: 25,
        text: "x + y",
        to: 26,
      },
    ]);
  });

  it("uses shared display-math parsing for multiline dollar equations", () => {
    const doc = "$$\nx + y\n$$ {#eq:sum}";

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 0,
        id: "eq:sum",
        labelFrom: 14,
        labelTo: 20,
        text: "x + y",
        to: 21,
      },
    ]);
  });

  it("uses shared display-math parsing for bracket equations", () => {
    const doc = "\\[\nx + y\n\\] {#eq:sum}";

    expect(extractMarkdownEquations(doc)).toEqual([
      {
        from: 0,
        id: "eq:sum",
        labelFrom: 14,
        labelTo: 20,
        text: "x + y",
        to: 21,
      },
    ]);
  });

  it("ignores malformed display math that the block scanner rejects", () => {
    expect(extractMarkdownEquations("$$\nx + y\nnot a closer {#eq:nope}")).toEqual([]);
  });
});
