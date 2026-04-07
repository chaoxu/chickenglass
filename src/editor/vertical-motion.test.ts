import { describe, expect, it } from "vitest";
import {
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
