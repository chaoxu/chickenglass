import { describe, expect, it } from "vitest";

import { collectSourceBlockRanges } from "./block-scanner";

describe("collectSourceBlockRanges grid tables", () => {
  it("preserves Pandoc grid tables as raw source block ranges", () => {
    const doc = [
      "Before",
      "",
      "+-------+------------------+",
      "| Input | Output           |",
      "+=======+==================+",
      "| graph | first paragraph  |",
      "|       |                  |",
      "|       | second paragraph |",
      "+-------+------------------+",
      "",
      "After",
    ].join("\n");

    const ranges = collectSourceBlockRanges(doc);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].variant).toBe("grid-table");
    expect(ranges[0].raw).toBe([
      "+-------+------------------+",
      "| Input | Output           |",
      "+=======+==================+",
      "| graph | first paragraph  |",
      "|       |                  |",
      "|       | second paragraph |",
      "+-------+------------------+",
    ].join("\n"));
  });
});
