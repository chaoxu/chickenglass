import { describe, expect, it } from "vitest";

import {
  decodePipeTableCellMarkdown,
  encodePipeTableCellMarkdown,
  parseMarkdownTable,
  serializeMarkdownTable,
} from "./table-markdown";

describe("table-markdown", () => {
  it("parses alignments, escaped pipes, and short rows", () => {
    expect(parseMarkdownTable([
      "| Left | Right |",
      "| :--- | ---: |",
      "| a \\| b | 1 |",
      "| c |",
    ].join("\n"))).toEqual({
      alignments: ["left", "right"],
      dividerCells: [":---", "---:"],
      headers: ["Left", "Right"],
      rows: [
        ["a | b", "1"],
        ["c", ""],
      ],
    });
  });

  it("serializes normalized markdown tables", () => {
    expect(serializeMarkdownTable({
      alignments: ["left", "right"],
      dividerCells: [":---", "---:"],
      headers: ["Left", "Right"],
      rows: [["a", "1"]],
    })).toBe([
      "| Left | Right |",
      "|:---|---:|",
      "| a | 1 |",
    ].join("\n"));
  });

  it("escapes literal pipes when serializing cells", () => {
    expect(serializeMarkdownTable({
      alignments: [null],
      headers: ["A | B"],
      rows: [["x | y"]],
    })).toBe([
      "| A \\| B |",
      "|---|",
      "| x \\| y |",
    ].join("\n"));
  });

  it("parses pipes inside math and code spans as cell content", () => {
    expect(parseMarkdownTable([
      "| Dollar | Paren | Code |",
      "|---|---|---|",
      "| $a | b$ | \\(a \\| b\\) | `a | b` |",
    ].join("\n"))).toEqual({
      alignments: [null, null, null],
      dividerCells: ["---", "---", "---"],
      headers: ["Dollar", "Paren", "Code"],
      rows: [["$a | b$", "\\(a \\| b\\)", "`a | b`"]],
    });
  });

  it("splits pipes inside dollar spans that Pandoc will not close before a digit", () => {
    expect(parseMarkdownTable([
      "| Left | Middle | Right |",
      "|---|---|---|",
      "| $a | b$2 | c |",
    ].join("\n"))).toEqual({
      alignments: [null, null, null],
      dividerCells: ["---", "---", "---"],
      headers: ["Left", "Middle", "Right"],
      rows: [["$a", "b$2", "c"]],
    });
  });

  it("serializes only literal separator pipes outside math and code spans", () => {
    expect(serializeMarkdownTable({
      alignments: [null, null, null, null],
      headers: ["Literal", "Dollar", "Paren", "Code"],
      rows: [["a | b", "$a | b$", "\\(a \\| b\\)", "`a | b`"]],
    })).toBe([
      "| Literal | Dollar | Paren | Code |",
      "|---|---|---|---|",
      "| a \\| b | $a | b$ | \\(a \\| b\\) | `a | b` |",
    ].join("\n"));
  });

  it("decodes HTML breaks as markdown hard breaks outside code and math", () => {
    expect(decodePipeTableCellMarkdown("a<br>b")).toBe("a  \nb");
    expect(decodePipeTableCellMarkdown("`a<br>b`")).toBe("`a<br>b`");
    expect(decodePipeTableCellMarkdown("$a<br>b$")).toBe("$a<br>b$");
    expect(decodePipeTableCellMarkdown("\\(a<br>b\\)")).toBe("\\(a<br>b\\)");
  });

  it("encodes multiline table-cell markdown with HTML breaks", () => {
    expect(encodePipeTableCellMarkdown(" a  \n b \n\n c ")).toBe("a<br>b<br>c");
  });
});
