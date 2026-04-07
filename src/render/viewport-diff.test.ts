import { describe, expect, it } from "vitest";
import { diffVisibleRanges } from "./viewport-diff";

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
