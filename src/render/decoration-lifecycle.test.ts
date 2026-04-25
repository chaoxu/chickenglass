import { Decoration, type DecorationSet } from "@codemirror/view";
import { RangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { removeDecorationsInRanges } from "./decoration-lifecycle";

function makeRange(from: number, to: number): DecorationSet {
  return RangeSet.of([Decoration.mark({ class: "x" }).range(from, to)], true);
}

function rangeBounds(set: DecorationSet): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    out.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return out;
}

describe("removeDecorationsInRanges (touch semantics)", () => {
  it("retains a decoration whose end coincides with an empty dirty range", () => {
    const decorations = makeRange(10, 20);
    const next = removeDecorationsInRanges(decorations, [{ from: 20, to: 20 }]);
    expect(rangeBounds(next)).toEqual([{ from: 10, to: 20 }]);
  });

  it("retains a decoration whose start coincides with an empty dirty range", () => {
    const decorations = makeRange(10, 20);
    const next = removeDecorationsInRanges(decorations, [{ from: 10, to: 10 }]);
    expect(rangeBounds(next)).toEqual([{ from: 10, to: 20 }]);
  });

  it("removes a decoration when an empty dirty range sits in its interior", () => {
    const decorations = makeRange(10, 20);
    const next = removeDecorationsInRanges(decorations, [{ from: 15, to: 15 }]);
    expect(rangeBounds(next)).toHaveLength(0);
  });

  it("retains a decoration that does not overlap the dirty range at all", () => {
    const decorations = makeRange(10, 20);
    const next = removeDecorationsInRanges(decorations, [{ from: 30, to: 35 }]);
    expect(rangeBounds(next)).toEqual([{ from: 10, to: 20 }]);
  });

  it("non-empty ranges that share only a boundary do not touch", () => {
    // Decoration [10, 20] and dirty [5, 10] meet at point 10 but their
    // intersection is empty; only insertion points (empty ranges) treat the
    // boundary as a touch.
    const decorations = makeRange(10, 20);
    const next = removeDecorationsInRanges(decorations, [{ from: 5, to: 10 }]);
    expect(rangeBounds(next)).toEqual([{ from: 10, to: 20 }]);
  });

  it("non-empty ranges that overlap in the interior touch", () => {
    const decorations = makeRange(10, 20);
    const next = removeDecorationsInRanges(decorations, [{ from: 5, to: 11 }]);
    expect(rangeBounds(next)).toHaveLength(0);
  });
});
