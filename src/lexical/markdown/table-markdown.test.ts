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
