import { describe, expect, it } from "vitest";

import {
  findNextInlineMathSource,
  parseInlineMathSource,
  stripInlineMathDelimiters,
} from "./inline-math-source";
import { containsMarkdownMath } from "./markdown-math";

describe("inline math source parser", () => {
  it.each([
    ["$k$", "dollar", "k", 1, 2],
    ["$a\\$b$", "dollar", "a\\$b", 1, 5],
    ["\\(x + y\\)", "paren", "x + y", 2, 7],
    ["\\(x \\) y\\)", "paren", "x \\) y", 2, 8],
  ] as const)("parses valid %s math", (raw, delimiter, body, bodyFrom, bodyTo) => {
    expect(parseInlineMathSource(raw)).toMatchObject({
      body,
      bodyFrom,
      bodyTo,
      delimiter,
      from: 0,
      raw,
      to: raw.length,
    });
    expect(stripInlineMathDelimiters(raw)).toBe(body);
  });

  it.each([
    "",
    "$$",
    "$ $",
    "$x",
    "x$",
    "$x\ny$",
    "\\(\\)",
    "\\(x",
  ])("rejects invalid inline math source %s", (raw) => {
    expect(parseInlineMathSource(raw)).toBeNull();
    expect(stripInlineMathDelimiters(raw)).toBe(raw);
  });

  it("finds inline math in surrounding text with source spans", () => {
    expect(findNextInlineMathSource("A $k$-hitting set")).toMatchObject({
      body: "k",
      bodyFrom: 3,
      bodyTo: 4,
      from: 2,
      to: 5,
    });
  });

  it("keeps citation-style tight dollar matching behavior", () => {
    expect(findNextInlineMathSource("A $k$ set", 0, { requireTightDollar: true })).not.toBeNull();
    expect(findNextInlineMathSource("A $ k $ set", 0, { requireTightDollar: true })).toBeNull();
    expect(containsMarkdownMath("A \\(k\\)-set")).toBe(true);
    expect(containsMarkdownMath("A $ k $ set")).toBe(false);
  });
});
