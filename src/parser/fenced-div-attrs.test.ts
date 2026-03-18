import { describe, expect, it } from "vitest";

import { extractDivClass, parseFencedDivAttrs } from "./fenced-div-attrs";

describe("parseFencedDivAttrs", () => {
  it("parses a single class", () => {
    const result = parseFencedDivAttrs("{.theorem}");
    expect(result).toEqual({
      classes: ["theorem"],
      id: undefined,
      keyValues: {},
    });
  });

  it("parses a single id", () => {
    const result = parseFencedDivAttrs("{#my-thm}");
    expect(result).toEqual({
      classes: [],
      id: "my-thm",
      keyValues: {},
    });
  });

  it("parses class and id together", () => {
    const result = parseFencedDivAttrs("{.theorem #my-thm}");
    expect(result).toEqual({
      classes: ["theorem"],
      id: "my-thm",
      keyValues: {},
    });
  });

  it("parses multiple classes", () => {
    const result = parseFencedDivAttrs("{.theorem .important}");
    expect(result).toEqual({
      classes: ["theorem", "important"],
      id: undefined,
      keyValues: {},
    });
  });

  it("parses key=value pair", () => {
    const result = parseFencedDivAttrs("{.theorem counter=theorem}");
    expect(result).toEqual({
      classes: ["theorem"],
      id: undefined,
      keyValues: { counter: "theorem" },
    });
  });

  it("parses quoted value", () => {
    const result = parseFencedDivAttrs('{.proof key="some value"}');
    expect(result).toEqual({
      classes: ["proof"],
      id: undefined,
      keyValues: { key: "some value" },
    });
  });

  it("parses full attribute string with class, id, and key-value", () => {
    const result = parseFencedDivAttrs("{.theorem #thm-1 counter=theorem}");
    expect(result).toEqual({
      classes: ["theorem"],
      id: "thm-1",
      keyValues: { counter: "theorem" },
    });
  });

  it("handles extra whitespace", () => {
    const result = parseFencedDivAttrs("{  .theorem   #id  }");
    expect(result).toEqual({
      classes: ["theorem"],
      id: "id",
      keyValues: {},
    });
  });

  it("handles surrounding whitespace", () => {
    const result = parseFencedDivAttrs("  {.theorem}  ");
    expect(result).toEqual({
      classes: ["theorem"],
      id: undefined,
      keyValues: {},
    });
  });

  it("returns undefined for empty braces", () => {
    expect(parseFencedDivAttrs("{}")).toBeUndefined();
  });

  it("returns undefined for missing braces", () => {
    expect(parseFencedDivAttrs(".theorem")).toBeUndefined();
  });

  it("returns undefined for unterminated quote", () => {
    expect(parseFencedDivAttrs('{key="unterminated}')).toBeUndefined();
  });

  it("returns undefined for bare dot", () => {
    expect(parseFencedDivAttrs("{.}")).toBeUndefined();
  });

  it("returns undefined for bare hash", () => {
    expect(parseFencedDivAttrs("{#}")).toBeUndefined();
  });

  it("parses identifiers with colons and periods", () => {
    const result = parseFencedDivAttrs("{#eq:foo.bar}");
    expect(result).toEqual({
      classes: [],
      id: "eq:foo.bar",
      keyValues: {},
    });
  });

  it("uses last id when multiple are given", () => {
    const result = parseFencedDivAttrs("{#first #second}");
    expect(result).toEqual({
      classes: [],
      id: "second",
      keyValues: {},
    });
  });

  it("parses multiple key-value pairs", () => {
    const result = parseFencedDivAttrs("{counter=theorem numbered=true}");
    expect(result).toEqual({
      classes: [],
      id: undefined,
      keyValues: { counter: "theorem", numbered: "true" },
    });
  });

  it("parses title key-value", () => {
    const result = parseFencedDivAttrs('{.theorem #thm-1 title="Main result"}');
    expect(result).toEqual({
      classes: ["theorem"],
      id: "thm-1",
      keyValues: { title: "Main result" },
    });
  });

  it("parses multiple key-value pairs including title and status", () => {
    const result = parseFencedDivAttrs('{.theorem #thm-1 title="Main result" status="draft"}');
    expect(result).toEqual({
      classes: ["theorem"],
      id: "thm-1",
      keyValues: { title: "Main result", status: "draft" },
    });
  });
});

describe("extractDivClass", () => {
  it("handles full attribute block with braces", () => {
    const result = extractDivClass("{.theorem #thm-1}");
    expect(result).toEqual({
      classes: ["theorem"],
      id: "thm-1",
      keyValues: {},
    });
  });

  it("handles bare class name (short-form)", () => {
    const result = extractDivClass("Theorem");
    expect(result).toEqual({
      classes: ["theorem"],
      id: undefined,
      keyValues: {},
    });
  });

  it("lowercases bare class names", () => {
    const result = extractDivClass("Definition");
    expect(result).toEqual({
      classes: ["definition"],
      id: undefined,
      keyValues: {},
    });
  });

  it("handles bare class name with mixed case", () => {
    const result = extractDivClass("LEMMA");
    expect(result).toEqual({
      classes: ["lemma"],
      id: undefined,
      keyValues: {},
    });
  });

  it("returns undefined for empty string", () => {
    expect(extractDivClass("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(extractDivClass("   ")).toBeUndefined();
  });

  it("trims whitespace from bare class name", () => {
    const result = extractDivClass("  Theorem  ");
    expect(result).toEqual({
      classes: ["theorem"],
      id: undefined,
      keyValues: {},
    });
  });

  it("handles braced attributes with title key", () => {
    const result = extractDivClass('{.theorem #thm-1 title="Main result" status="draft"}');
    expect(result).toEqual({
      classes: ["theorem"],
      id: "thm-1",
      keyValues: { title: "Main result", status: "draft" },
    });
  });
});
