import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  firstOverlapIndex,
  mapRangeObject,
  rangesOverlap,
  replaceOverlappingRanges,
  type RangeLike,
} from "./merge-utils";

interface TestRange extends RangeLike {
  readonly id: string;
}

function makeChanges(
  doc: string,
  changes: { from: number; to?: number; insert?: string }[],
) {
  const state = EditorState.create({ doc });
  return state.update({ changes }).changes;
}

function range(id: string, from: number, to: number): TestRange {
  return { id, from, to };
}

describe("mapRangeObject", () => {
  it("shifts a range when text is inserted at its start boundary", () => {
    const original = range("math", 6, 11);

    const mapped = mapRangeObject(
      original,
      makeChanges("alpha beta gamma", [{ from: 6, insert: "new " }]),
    );

    expect(mapped).toEqual(range("math", 10, 15));
    expect(mapped).not.toBe(original);
  });

  it("reuses identity when text is inserted at its end boundary", () => {
    const original = range("math", 6, 11);

    const mapped = mapRangeObject(
      original,
      makeChanges("alpha beta gamma", [{ from: 11, insert: "!" }]),
    );

    expect(mapped).toBe(original);
  });

  it("collapses a fully deleted range to a point", () => {
    const original = range("math", 5, 8);

    const mapped = mapRangeObject(
      original,
      makeChanges("0123456789", [{ from: 5, to: 8 }]),
    );

    expect(mapped).toEqual(range("math", 5, 5));
  });
});

describe("rangesOverlap", () => {
  it("treats touching boundaries as non-overlapping", () => {
    expect(rangesOverlap(range("a", 0, 5), range("b", 5, 10))).toBe(false);
    expect(rangesOverlap(range("a", 0, 5), range("b", 4, 10))).toBe(true);
  });

  it("treats matching zero-length ranges as overlapping", () => {
    expect(rangesOverlap(range("a", 5, 5), range("b", 5, 5))).toBe(true);
    expect(rangesOverlap(range("a", 5, 5), range("b", 6, 6))).toBe(false);
  });

  it("treats collapsed points as overlapping a dirty-window boundary", () => {
    expect(rangesOverlap(range("a", 7, 7), { from: 5, to: 7 })).toBe(true);
    expect(rangesOverlap(range("a", 0, 5), { from: 5, to: 5 })).toBe(false);
  });
});

describe("firstOverlapIndex", () => {
  const values = [
    range("a", 0, 5),
    range("b", 10, 15),
    range("c", 20, 25),
  ];

  it("finds the first overlapping sorted range", () => {
    expect(firstOverlapIndex(values, { from: 12, to: 22 })).toBe(1);
  });

  it("returns -1 when the window falls in a gap", () => {
    expect(firstOverlapIndex(values, { from: 5, to: 10 })).toBe(-1);
  });

  it("finds a same-point zero-length range after a touching predecessor", () => {
    const withPoint = [
      range("a", 0, 5),
      range("b", 5, 5),
      range("c", 8, 12),
    ];

    expect(firstOverlapIndex(withPoint, { from: 5, to: 5 })).toBe(1);
  });
});

describe("replaceOverlappingRanges", () => {
  it("keeps a range untouched when an insert happens at its end boundary", () => {
    const original = range("math", 5, 8);
    const mapped = mapRangeObject(
      original,
      makeChanges("0123456789", [{ from: 8, insert: "XY" }]),
    );
    const values = [mapped];

    const result = replaceOverlappingRanges(values, { from: 8, to: 10 }, []);

    expect(mapped).toBe(original);
    expect(result).toBe(values);
  });

  it("replaces all overlapping ranges and preserves untouched identity", () => {
    const a = range("a", 0, 5);
    const b = range("b", 10, 15);
    const c = range("c", 20, 25);
    const d = range("d", 30, 35);
    const x = range("x", 12, 14);
    const y = range("y", 18, 22);

    const result = replaceOverlappingRanges(
      [a, b, c, d],
      { from: 12, to: 23 },
      [x, y],
    );

    expect(result).toEqual([a, x, y, d]);
    expect(result[0]).toBe(a);
    expect(result[3]).toBe(d);
  });

  it("splices fresh ranges into the correct sorted gap", () => {
    const a = range("a", 0, 5);
    const c = range("c", 20, 25);
    const x = range("x", 10, 12);
    const y = range("y", 13, 15);

    const result = replaceOverlappingRanges(
      [a, c],
      { from: 10, to: 15 },
      [x, y],
    );

    expect(result).toEqual([a, x, y, c]);
    expect(result[0]).toBe(a);
    expect(result[3]).toBe(c);
  });

  it("drops a fully deleted range that collapses to the dirty-window point", () => {
    const prefix = range("prefix", 0, 5);
    const deleted = range("deleted", 5, 5);
    const suffix = range("suffix", 8, 12);
    const values = [prefix, deleted, suffix];

    const result = replaceOverlappingRanges(values, { from: 5, to: 5 }, []);

    expect(result).toEqual([prefix, suffix]);
    expect(result[0]).toBe(prefix);
    expect(result[1]).toBe(suffix);
  });

  it("drops a collapsed range after a replacement that inserts new text", () => {
    const stale = mapRangeObject(
      range("stale", 6, 7),
      makeChanges("0123456789", [{ from: 5, to: 8, insert: "XY" }]),
    );

    const result = replaceOverlappingRanges([stale], { from: 5, to: 7 }, []);

    expect(stale).toEqual(range("stale", 7, 7));
    expect(result).toEqual([]);
  });
});
