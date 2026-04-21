import { describe, expect, it } from "vitest";
import {
  boundedDirectionalScrollTop,
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

  it("corrects medium downward reverse scroll during structure handoff", () => {
    expect(correctedReverseVerticalScrollTop(
      { head: 3590, line: 146, scrollTop: 2345 },
      { head: 3603, line: 147, scrollTop: 2232 },
      24,
    )).toBe(2369);
  });

  it("leaves normal vertical motion alone", () => {
    expect(correctedReverseVerticalScrollTop(
      { head: 100, line: 20, scrollTop: 1200 },
      { head: 90, line: 19, scrollTop: 1176 },
      24,
    )).toBeNull();
  });

  it("ignores tiny reverse-scroll jitter", () => {
    expect(correctedReverseVerticalScrollTop(
      { head: 90, line: 19, scrollTop: 1200 },
      { head: 100, line: 20, scrollTop: 1194 },
      24,
    )).toBeNull();
  });
});

describe("boundedDirectionalScrollTop", () => {
  it("bounds downward reveal scroll to a local step", () => {
    expect(boundedDirectionalScrollTop(1400, 1000, "down", 800)).toBe(1144);
  });

  it("bounds upward reveal scroll to a local step", () => {
    expect(boundedDirectionalScrollTop(600, 1000, "up", 800)).toBe(856);
  });

  it("keeps directional reveal monotonic around the baseline", () => {
    expect(boundedDirectionalScrollTop(900, 1000, "down", 800)).toBe(1000);
    expect(boundedDirectionalScrollTop(1100, 1000, "up", 800)).toBe(1000);
  });
});
