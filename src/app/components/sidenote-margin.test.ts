import { describe, expect, it } from "vitest";
import {
  findFirstAffectedSidenote,
  findFirstSidenoteAnchorChange,
  findFirstSidenoteEntryChange,
  findFirstSidenotePlacementChange,
  measureSidenotePositions,
} from "./sidenote-margin";

function entry(overrides: Partial<{
  id: string;
  number: number;
  content: string;
  refFrom: number;
  anchorY: number;
  defFrom: number;
}> = {}) {
  return {
    id: overrides.id ?? "note-1",
    number: overrides.number ?? 1,
    content: overrides.content ?? "Footnote",
    refFrom: overrides.refFrom ?? 1,
    anchorY: overrides.anchorY ?? 0,
    defFrom: overrides.defFrom ?? 10,
  };
}

describe("sidenote invalidation boundaries", () => {
  it("tracks metadata-only definition moves without treating them as placement changes", () => {
    const previous = [
      entry({ id: "a", refFrom: 5, anchorY: 12, defFrom: 40 }),
      entry({ id: "b", number: 2, refFrom: 15, anchorY: 48, defFrom: 80 }),
    ];
    const next = [
      previous[0],
      entry({ id: "b", number: 2, refFrom: 15, anchorY: 48, defFrom: 92 }),
    ];

    expect(findFirstSidenoteEntryChange(previous, next)).toBe(1);
    expect(findFirstSidenoteAnchorChange(previous, next)).toBe(-1);
    expect(findFirstSidenotePlacementChange(previous, next)).toBe(-1);
  });

  it("treats ref moves and content changes as placement changes", () => {
    const previous = [
      entry({ id: "a", refFrom: 5, anchorY: 12 }),
      entry({ id: "b", number: 2, refFrom: 15, anchorY: 48, defFrom: 20 }),
      entry({ id: "c", number: 3, refFrom: 25, anchorY: 90, defFrom: 40 }),
    ];

    expect(findFirstSidenoteAnchorChange(previous, [
      previous[0],
      entry({ id: "b", number: 2, refFrom: 18, anchorY: 48, defFrom: 20 }),
      previous[2],
    ])).toBe(1);

    expect(findFirstSidenotePlacementChange(previous, [
      previous[0],
      entry({ id: "b", number: 2, refFrom: 15, anchorY: 48, content: "Updated", defFrom: 20 }),
      previous[2],
    ])).toBe(1);

    expect(findFirstSidenotePlacementChange(previous, previous.slice(0, 2))).toBe(2);
  });

  it("finds the first sidenote whose anchor can move after a local layout edit", () => {
    const entries = [
      entry({ id: "a", refFrom: 5 }),
      entry({ id: "b", refFrom: 25, number: 2 }),
      entry({ id: "c", refFrom: 55, number: 3 }),
    ];

    expect(findFirstAffectedSidenote(entries, 20)).toBe(1);
    expect(findFirstAffectedSidenote(entries, 60)).toBe(-1);
  });
});

describe("measureSidenotePositions", () => {
  it("reuses an unchanged prefix and remeasures only the affected suffix", () => {
    const entries = [
      entry({ id: "a", anchorY: 10 }),
      entry({ id: "b", number: 2, anchorY: 60, defFrom: 20 }),
      entry({ id: "c", number: 3, anchorY: 70, defFrom: 40 }),
    ];
    const itemRefs = new Map([
      ["a", { offsetHeight: 20 }],
      ["b", { offsetHeight: 30 }],
      ["c", { offsetHeight: 25 }],
    ]);

    expect(measureSidenotePositions(entries, itemRefs, [10, 60, 90], 1)).toEqual([10, 60, 98]);
  });

  it("clips stale trailing positions when sidenotes are removed at the end", () => {
    const entries = [
      entry({ id: "a", anchorY: 10 }),
      entry({ id: "b", number: 2, anchorY: 60, defFrom: 20 }),
    ];
    const itemRefs = new Map([
      ["a", { offsetHeight: 20 }],
      ["b", { offsetHeight: 30 }],
    ]);

    expect(measureSidenotePositions(entries, itemRefs, [10, 60, 98], 2)).toEqual([10, 60]);
  });

  it("supports full remeasurement when note heights change globally", () => {
    const entries = [
      entry({ id: "a", anchorY: 10 }),
      entry({ id: "b", number: 2, anchorY: 20, defFrom: 20 }),
    ];
    const itemRefs = new Map([
      ["a", { offsetHeight: 40 }],
      ["b", { offsetHeight: 30 }],
    ]);

    expect(measureSidenotePositions(entries, itemRefs, [10, 38], 0)).toEqual([10, 58]);
  });
});
