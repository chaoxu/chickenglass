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
        rawText: "@thm-main; @eq:first, p. 2",
        ids: ["thm-main", "eq:first"],
        locators: [undefined, "p. 2"],
      },
    ]);
  });
});
