import { describe, expect, it } from "vitest";
import { scanTableInlineSpan } from "./table-inline-span";

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
});
