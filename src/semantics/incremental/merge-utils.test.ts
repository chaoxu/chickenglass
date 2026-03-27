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
  it("maps range positions through document changes", () => {
    const original = range("math", 6, 11);

    const mapped = mapRangeObject(
      original,
      makeChanges("alpha beta gamma", [{ from: 0, insert: "new " }]),
    );

    expect(mapped).toEqual(range("math", 10, 15));
    expect(mapped).not.toBe(original);
  });

  it("reuses identity when mapped positions are unchanged", () => {
    const original = range("math", 0, 5);

    const mapped = mapRangeObject(
      original,
      makeChanges("alpha beta", [{ from: 10, insert: "!" }]),
    );

    expect(mapped).toBe(original);
  });
});

describe("rangesOverlap", () => {
  it("treats touching boundaries as non-overlapping", () => {
    expect(rangesOverlap(range("a", 0, 5), range("b", 5, 10))).toBe(false);
    expect(rangesOverlap(range("a", 0, 5), range("b", 4, 10))).toBe(true);
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
});

describe("replaceOverlappingRanges", () => {
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

  it("returns the original array when there is nothing to replace", () => {
    const values = [range("a", 0, 5), range("b", 20, 25)];

    const result = replaceOverlappingRanges(values, { from: 8, to: 12 }, []);

    expect(result).toBe(values);
  });
});
