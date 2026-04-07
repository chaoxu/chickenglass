import { describe, expect, it } from "vitest";
import {
  correctedVisibleLineJump,
  correctedReverseVerticalScrollTop,
  sumTraversedLineHeights,
} from "./vertical-motion";

describe("sumTraversedLineHeights", () => {
  const heights = new Map([
    [5, 24],
    [6, 48],
    [7, 72],
  ]);

  it("sums destination-side lines when moving upward", () => {
    expect(sumTraversedLineHeights(7, 5, (line) => heights.get(line) ?? 0)).toBe(72);
  });

  it("sums source-side lines when moving downward", () => {
    expect(sumTraversedLineHeights(5, 7, (line) => heights.get(line) ?? 0)).toBe(72);
  });
});

describe("correctedReverseVerticalScrollTop", () => {
  it("clamps reverse upward scroll by the traversed height", () => {
    expect(correctedReverseVerticalScrollTop(
      { head: 100, line: 20, scrollTop: 1200 },
      { head: 90, line: 19, scrollTop: 1440 },
      24,
    )).toBe(1176);
  });

  it("clamps reverse downward scroll by the traversed height", () => {
    expect(correctedReverseVerticalScrollTop(
      { head: 90, line: 19, scrollTop: 1200 },
      { head: 100, line: 20, scrollTop: 960 },
      24,
    )).toBe(1224);
  });

  it("leaves normal vertical motion alone", () => {
    expect(correctedReverseVerticalScrollTop(
      { head: 100, line: 20, scrollTop: 1200 },
      { head: 90, line: 19, scrollTop: 1176 },
      24,
    )).toBeNull();
  });
});

describe("correctedVisibleLineJump", () => {
  it("returns the first visible intervening line when downward motion skips past it", () => {
    const visible = new Set([9, 10, 11, 12]);
    expect(
      correctedVisibleLineJump(8, 16, (line) => visible.has(line)),
    ).toBe(9);
  });

  it("returns null when skipped lines are hidden", () => {
    expect(
      correctedVisibleLineJump(6, 8, () => false),
    ).toBeNull();
  });

  it("returns the nearest visible intervening line on upward skips too", () => {
    const visible = new Set([5, 6, 7]);
    expect(
      correctedVisibleLineJump(10, 4, (line) => visible.has(line)),
    ).toBe(7);
  });
});
