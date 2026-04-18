import { describe, expect, it } from "vitest";

import { parseMarkdownTable, serializeMarkdownTable } from "./table-markdown";

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
});
