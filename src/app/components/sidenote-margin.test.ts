import { describe, expect, it } from "vitest";
import {
  findFirstSidenoteLayoutChange,
  measureSidenotePositions,
} from "./sidenote-margin";

function entry(overrides: Partial<{
  id: string;
  number: number;
  content: string;
  anchorY: number;
  defFrom: number;
}> = {}) {
  return {
    id: overrides.id ?? "note-1",
    number: overrides.number ?? 1,
    content: overrides.content ?? "Footnote",
    anchorY: overrides.anchorY ?? 0,
    defFrom: overrides.defFrom ?? 1,
  };
}

describe("findFirstSidenoteLayoutChange", () => {
  it("returns -1 when sidenote layout inputs are unchanged", () => {
    const entries = [
      entry({ id: "a", anchorY: 12 }),
      entry({ id: "b", number: 2, anchorY: 48, defFrom: 20 }),
    ];

    expect(findFirstSidenoteLayoutChange(entries, [...entries])).toBe(-1);
  });

  it("returns the first changed index for anchor, content, or length changes", () => {
    const previous = [
      entry({ id: "a", anchorY: 12 }),
      entry({ id: "b", number: 2, anchorY: 48, defFrom: 20 }),
      entry({ id: "c", number: 3, anchorY: 90, defFrom: 40 }),
    ];

    expect(findFirstSidenoteLayoutChange(previous, [
      previous[0],
      entry({ id: "b", number: 2, anchorY: 60, defFrom: 20 }),
      previous[2],
    ])).toBe(1);

    expect(findFirstSidenoteLayoutChange(previous, previous.slice(0, 2))).toBe(2);
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
