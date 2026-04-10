import { EditorState, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  clampDocPos,
  collectOverlappingOrderedRanges,
  containsPos,
  containsPosExclusiveEnd,
  containsRange,
  expandChangeQueryRange,
  expandRangeToLineBounds,
  getMergedRangeCoverage,
  getOrderedRangePrefixMaxTo,
  rangesIntersect,
  rangesOverlap,
  toRanges,
} from "./range-helpers";

describe("containsPos", () => {
  it("includes both range boundaries", () => {
    expect(containsPos({ from: 5, to: 10 }, 5)).toBe(true);
    expect(containsPos({ from: 5, to: 10 }, 10)).toBe(true);
    expect(containsPos({ from: 5, to: 10 }, 11)).toBe(false);
  });
});

describe("containsRange", () => {
  it("includes both inner range boundaries", () => {
    expect(containsRange({ from: 5, to: 10 }, { from: 5, to: 10 })).toBe(true);
    expect(containsRange({ from: 5, to: 10 }, { from: 6, to: 9 })).toBe(true);
    expect(containsRange({ from: 5, to: 10 }, { from: 4, to: 9 })).toBe(false);
  });
});

describe("rangesOverlap", () => {
  it("treats touching endpoints as overlapping", () => {
    expect(rangesOverlap({ from: 0, to: 5 }, { from: 5, to: 10 })).toBe(true);
    expect(rangesOverlap({ from: 0, to: 5 }, { from: 6, to: 10 })).toBe(false);
  });
});

describe("containsPosExclusiveEnd", () => {
  it("includes the start boundary but excludes the end boundary", () => {
    expect(containsPosExclusiveEnd({ from: 5, to: 10 }, 5)).toBe(true);
    expect(containsPosExclusiveEnd({ from: 5, to: 10 }, 10)).toBe(false);
  });
});

describe("rangesIntersect", () => {
  it("treats touching endpoints as non-intersecting", () => {
    expect(rangesIntersect({ from: 0, to: 5 }, { from: 5, to: 10 })).toBe(false);
    expect(rangesIntersect({ from: 0, to: 5 }, { from: 4, to: 10 })).toBe(true);
  });
});

describe("toRanges", () => {
  it("strips extra fields while preserving order", () => {
    expect(toRanges([
      { id: "a", from: 1, to: 3 },
      { id: "b", from: 5, to: 8 },
    ])).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 8 },
    ]);
  });
});

describe("document range helpers", () => {
  it("clamps document positions into bounds", () => {
    const doc = Text.of(["alpha", "beta"]);
    expect(clampDocPos(doc, -5)).toBe(0);
    expect(clampDocPos(doc, 100)).toBe(doc.length);
  });

  it("expands reversed offsets to full line bounds", () => {
    const state = EditorState.create({ doc: "alpha\nbeta\ngamma" });
    expect(expandRangeToLineBounds(state.doc, 10, 2)).toEqual({
      from: state.doc.line(2).from,
      to: state.doc.line(2).to,
    });
  });

  it("handles empty documents", () => {
    expect(expandRangeToLineBounds(Text.empty, 5, 10)).toEqual({ from: 0, to: 0 });
  });

  it("widens change queries to neighboring line bounds", () => {
    const state = EditorState.create({ doc: "alpha\nbeta\ngamma" });
    expect(expandChangeQueryRange(state.doc, 6, 6)).toEqual({
      from: 0,
      to: state.doc.line(2).to,
    });
  });
});

describe("ordered range helpers", () => {
  it("builds a prefix max array for ordered ranges", () => {
    expect(getOrderedRangePrefixMaxTo([
      { from: 0, to: 3 },
      { from: 10, to: 12 },
      { from: 11, to: 20 },
    ])).toEqual([3, 12, 20]);
  });

  it("returns only overlapping ranges from an ordered slice", () => {
    expect(
      collectOverlappingOrderedRanges(
        [
          { from: 0, to: 6 },
          { from: 10, to: 16 },
          { from: 20, to: 26 },
          { from: 30, to: 36 },
        ],
        { from: 12, to: 31 },
      ),
    ).toEqual([
      { from: 10, to: 16 },
      { from: 20, to: 26 },
      { from: 30, to: 36 },
    ]);
  });

  it("collapses nested coverage intervals", () => {
    const coverage = getMergedRangeCoverage([
      { from: 0, to: 100 },
      { from: 10, to: 20 },
      { from: 30, to: 40 },
      { from: 120, to: 135 },
      { from: 130, to: 150 },
    ]);

    expect(coverage).toEqual([
      { from: 0, to: 100 },
      { from: 120, to: 150 },
    ]);
    expect(
      collectOverlappingOrderedRanges(coverage, { from: 90, to: 95 }),
    ).toEqual([{ from: 0, to: 100 }]);
  });
});
