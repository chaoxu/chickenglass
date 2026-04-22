import { describe, expect, it } from "vitest";
import { collectGeometryViolations } from "./geometry-audit.mjs";

function resultWithLines(lines) {
  return [{
    scenario: "structure",
    result: {
      deltas: [{
        from: "before",
        to: "after",
        lines,
      }],
    },
  }];
}

describe("geometry audit tolerances", () => {
  it("treats deltas within configured tolerances as clean", () => {
    expect(
      collectGeometryViolations(
        resultWithLines([
          { line: 4, topDelta: 1, heightDelta: -2, before: {}, after: {} },
        ]),
        { maxTopDelta: 1, maxHeightDelta: 2 },
      ),
    ).toEqual([]);
  });

  it("reports top, height, and missing-line violations", () => {
    expect(
      collectGeometryViolations(
        resultWithLines([
          { line: 4, topDelta: 2, heightDelta: 0, before: {}, after: {} },
          { line: 5, topDelta: 0, heightDelta: -3, before: {}, after: {} },
          { line: 6, before: null, after: {} },
        ]),
        { maxTopDelta: 1, maxHeightDelta: 2 },
      ),
    ).toEqual([
      {
        scenario: "structure",
        from: "before",
        to: "after",
        line: 4,
        topDelta: 2,
        heightDelta: 0,
        missingBefore: false,
        missingAfter: false,
      },
      {
        scenario: "structure",
        from: "before",
        to: "after",
        line: 5,
        topDelta: 0,
        heightDelta: -3,
        missingBefore: false,
        missingAfter: false,
      },
      {
        scenario: "structure",
        from: "before",
        to: "after",
        line: 6,
        topDelta: 0,
        heightDelta: 0,
        missingBefore: true,
        missingAfter: false,
      },
    ]);
  });
});
