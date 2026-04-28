import { describe, expect, it } from "vitest";

import {
  parseInlineSource,
  parseInlineSourceExact,
} from "./inline-source-model";

describe("inline source model", () => {
  it("parses revealable inline source spans with positions", () => {
    const markdown = [
      "See [**rich** link](https://example.com/a(b)c (paren title)),",
      "$x+1$,",
      "\\(y\\),",
      "![plot](plot.pdf),",
      "[^note],",
      "[@doe2020, p. 12; @roe2021],",
      "and @sec:intro.",
    ].join(" ");

    expect(parseInlineSource(markdown).map((span) => ({
      from: span.from,
      kind: span.kind,
      source: span.source,
      to: span.to,
    }))).toEqual([
      {
        from: markdown.indexOf("[**rich** link]"),
        kind: "link",
        source: "[**rich** link](https://example.com/a(b)c (paren title))",
        to: markdown.indexOf("[**rich** link]")
          + "[**rich** link](https://example.com/a(b)c (paren title))".length,
      },
      {
        from: markdown.indexOf("$x+1$"),
        kind: "inline-math",
        source: "$x+1$",
        to: markdown.indexOf("$x+1$") + "$x+1$".length,
      },
      {
        from: markdown.indexOf("\\(y\\)"),
        kind: "inline-math",
        source: "\\(y\\)",
        to: markdown.indexOf("\\(y\\)") + "\\(y\\)".length,
      },
      {
        from: markdown.indexOf("![plot]"),
        kind: "inline-image",
        source: "![plot](plot.pdf)",
        to: markdown.indexOf("![plot]") + "![plot](plot.pdf)".length,
      },
      {
        from: markdown.indexOf("[^note]"),
        kind: "footnote-reference",
        source: "[^note]",
        to: markdown.indexOf("[^note]") + "[^note]".length,
      },
      {
        from: markdown.indexOf("[@doe2020"),
        kind: "reference",
        source: "[@doe2020, p. 12; @roe2021]",
        to: markdown.indexOf("[@doe2020") + "[@doe2020, p. 12; @roe2021]".length,
      },
      {
        from: markdown.indexOf("@sec:intro"),
        kind: "reference",
        source: "@sec:intro",
        to: markdown.indexOf("@sec:intro") + "@sec:intro".length,
      },
    ]);
  });

  it("exposes parsed link and math metadata for reveal reparsing", () => {
    const link = parseInlineSourceExact("[label](<https://example.com/a b> 'title')");
    expect(link).toMatchObject({
      kind: "link",
      labelFrom: 1,
      labelMarkdown: "label",
      title: "title",
      url: "https://example.com/a b",
    });

    const math = parseInlineSourceExact("\\(x + y\\)");
    expect(math).toMatchObject({
      body: "x + y",
      bodyFrom: 2,
      bodyTo: 7,
      delimiter: "paren",
      kind: "inline-math",
    });
  });

  it("requires exact source when validating a reveal reparse", () => {
    expect(parseInlineSourceExact("[label](url) trailing")).toBeNull();
    expect(parseInlineSourceExact("@sec:intro.")).toBeNull();
    expect(parseInlineSourceExact("$ x $")).toBeNull();
  });
});
