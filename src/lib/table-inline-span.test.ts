import { describe, expect, it } from "vitest";
import {
  findTableCellSpans,
  findTablePipePositions,
  scanTableInlineSpan,
} from "./table-inline-span";

describe("scanTableInlineSpan", () => {
  it("never returns past text.length for incomplete trailing spans", () => {
    const cases = [
      { text: "\\", start: 0, expected: 1 },
      { text: "\\(", start: 0, expected: 2 },
      { text: "`", start: 0, expected: 1 },
      { text: "```", start: 0, expected: 3 },
      { text: "$", start: 0, expected: 1 },
      { text: "cell $", start: 5, expected: 6 },
    ];

    for (const testCase of cases) {
      const end = scanTableInlineSpan(testCase.text, testCase.start);
      expect(end).toBe(testCase.expected);
      expect(end).not.toBeNull();
      if (end === null) {
        throw new Error(`expected a span end for ${JSON.stringify(testCase)}`);
      }
      expect(end).toBeLessThanOrEqual(testCase.text.length);
    }
  });

  it("returns null for starts at EOF", () => {
    expect(scanTableInlineSpan("$", 1)).toBeNull();
  });

  it("finds only table separator pipes outside math and code spans", () => {
    const line = "| $a | b$ | \\(a \\| b\\) | `a | b` | literal \\| pipe |";

    expect(findTablePipePositions(line)).toEqual([
      0,
      10,
      23,
      33,
      51,
    ]);
  });

  it("does not suppress pipes for dollar spans that Pandoc will not close before a digit", () => {
    const line = "| $a | b$2 | c |";

    expect(findTablePipePositions(line)).toEqual([0, 5, 11, 15]);
  });

  it("returns row cell spans from only separator pipes", () => {
    const line = "| $a | b$ | \\(a \\| b\\) | `a | b` |";

    expect(findTableCellSpans(line)).toEqual([
      { from: 1, to: 10 },
      { from: 11, to: 23 },
      { from: 24, to: 33 },
    ]);
  });
});
