import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  diffVisibleRanges,
  mapVisibleRanges,
  mergeRanges,
  normalizeDirtyRange,
  rangeIntersectsRanges,
} from "./viewport-diff";

describe("diffVisibleRanges", () => {
  it("returns empty when new ranges are a subset of old", () => {
    expect(diffVisibleRanges([{ from: 0, to: 2000 }], [{ from: 500, to: 1500 }]))
      .toEqual([]);
  });

  it("returns empty when ranges are identical", () => {
    expect(diffVisibleRanges([{ from: 0, to: 1000 }], [{ from: 0, to: 1000 }]))
      .toEqual([]);
  });

  it("returns the newly-visible tail on scroll down", () => {
    expect(diffVisibleRanges(
      [{ from: 0, to: 1000 }],
      [{ from: 500, to: 2000 }],
    )).toEqual([{ from: 1000, to: 2000 }]);
  });

  it("returns the newly-visible head on scroll up", () => {
    expect(diffVisibleRanges(
      [{ from: 500, to: 1500 }],
      [{ from: 0, to: 1000 }],
    )).toEqual([{ from: 0, to: 500 }]);
  });

  it("returns full new range when there is no overlap", () => {
    expect(diffVisibleRanges(
      [{ from: 0, to: 100 }],
      [{ from: 200, to: 300 }],
    )).toEqual([{ from: 200, to: 300 }]);
  });

  it("returns all new ranges when old is empty", () => {
    expect(diffVisibleRanges([], [{ from: 0, to: 100 }]))
      .toEqual([{ from: 0, to: 100 }]);
  });

  it("returns empty when both are empty", () => {
    expect(diffVisibleRanges([], [])).toEqual([]);
  });

  it("handles multiple old ranges with a gap filled by new", () => {
    expect(diffVisibleRanges(
      [{ from: 0, to: 50 }, { from: 100, to: 150 }],
      [{ from: 40, to: 60 }, { from: 90, to: 160 }],
    )).toEqual([
      { from: 50, to: 60 },
      { from: 90, to: 100 },
      { from: 150, to: 160 },
    ]);
  });

  it("handles viewport expanding in both directions", () => {
    expect(diffVisibleRanges(
      [{ from: 200, to: 800 }],
      [{ from: 100, to: 1000 }],
    )).toEqual([
      { from: 100, to: 200 },
      { from: 800, to: 1000 },
    ]);
  });
});

describe("normalizeDirtyRange", () => {
  it("clamps reversed ranges into document order", () => {
    expect(normalizeDirtyRange(12, 4, 10)).toEqual({ from: 4, to: 10 });
  });

  it("widens zero-length updates to a one-character window in non-empty docs", () => {
    expect(normalizeDirtyRange(5, 5, 10)).toEqual({ from: 5, to: 6 });
  });

  it("keeps empty-doc updates at {0, 0}", () => {
    expect(normalizeDirtyRange(0, 0, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("mapVisibleRanges", () => {
  it("maps ranges through document edits", () => {
    const state = EditorState.create({ doc: "hello world" });
    const tr = state.update({ changes: { from: 6, to: 11, insert: "friend" } });
    expect(mapVisibleRanges([{ from: 6, to: 11 }], tr.changes)).toEqual([{ from: 6, to: 12 }]);
  });
});

describe("rangeIntersectsRanges", () => {
  it("treats zero-length points inside a range as intersecting", () => {
    expect(rangeIntersectsRanges(5, 5, [{ from: 0, to: 10 }])).toBe(true);
  });

  it("returns false when a point falls outside all ranges", () => {
    expect(rangeIntersectsRanges(12, 12, [{ from: 0, to: 10 }])).toBe(false);
  });
});

describe("mergeRanges", () => {
  it("does not merge adjacent ranges by default", () => {
    expect(mergeRanges([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
      { from: 5, to: 7 },
    ])).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 7 },
    ]);
  });

  it("merges ranges across a one-character gap when adjacency is enabled", () => {
    expect(mergeRanges([
      { from: 0, to: 2 },
      { from: 3, to: 4 },
      { from: 6, to: 8 },
    ], 1)).toEqual([
      { from: 0, to: 4 },
      { from: 6, to: 8 },
    ]);
  });
});
