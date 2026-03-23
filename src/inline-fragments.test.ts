import { describe, expect, it } from "vitest";

import { parseInlineFragments } from "./inline-fragments";

describe("parseInlineFragments", () => {
  it("builds shared fragments for emphasis, math, and code", () => {
    expect(parseInlineFragments("**Bold** $x^2$ `code`")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "Bold" }] },
      { kind: "text", text: " " },
      { kind: "math", latex: "x^2", raw: "$x^2$" },
      { kind: "text", text: " " },
      { kind: "code", text: "code" },
    ]);
  });

  it("parses bracketed references into reference fragments", () => {
    expect(parseInlineFragments("See [@thm-main; @eq:first, p. 2]")).toEqual([
      { kind: "text", text: "See " },
      {
        kind: "reference",
        parenthetical: true,
        rawText: "@thm-main; @eq:first, p. 2",
        ids: ["thm-main", "eq:first"],
        locators: [undefined, "p. 2"],
      },
    ]);
  });

  it("parses narrative references inside text fragments", () => {
    expect(parseInlineFragments("As @karger2000 showed.")).toEqual([
      { kind: "text", text: "As " },
      {
        kind: "reference",
        parenthetical: false,
        rawText: "@karger2000",
        ids: ["karger2000"],
        locators: [undefined],
      },
      { kind: "text", text: " showed." },
    ]);
  });
});
