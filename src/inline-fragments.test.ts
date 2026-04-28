import { describe, expect, it } from "vitest";

import { findInlineNeutralAnchor, parseInlineFragments } from "./inline-fragments";

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

  it("keeps reference-style links as noncanonical source text", () => {
    expect(parseInlineFragments("[text][ref]\n\n[ref]: https://example.com")[0]).toEqual({
      kind: "text",
      text: "[text][ref]\n\n[ref]: https://example.com",
    });
  });

  it("keeps bare URLs as noncanonical source text", () => {
    expect(parseInlineFragments("https://example.com")).toEqual([
      { kind: "text", text: "https://example.com" },
    ]);
  });

  it("parses angle autolinks as link fragments", () => {
    expect(parseInlineFragments("<https://example.com>")).toEqual([
      {
        kind: "link",
        href: "https://example.com",
        children: [{ kind: "text", text: "https://example.com" }],
      },
    ]);
  });

  it("keeps raw inline HTML as noncanonical source text", () => {
    expect(parseInlineFragments("H<sub>2</sub>O x<sup>2</sup><br>next")).toEqual([
      { kind: "text", text: "H<sub>2</sub>O x<sup>2</sup><br>next" },
    ]);
  });

  it("finds a neutral plain-text anchor between rich inline fragments", () => {
    expect(findInlineNeutralAnchor("**Bold** and $x^2$")).toBe(9);
    expect(findInlineNeutralAnchor("[@cormen2009] and ==highlight==")).toBe(14);
  });

  it("returns null when inline content has no safe plain-text gap", () => {
    expect(findInlineNeutralAnchor("$x^2$")).toBeNull();
    expect(findInlineNeutralAnchor("**Bold**")).toBeNull();
  });
});
