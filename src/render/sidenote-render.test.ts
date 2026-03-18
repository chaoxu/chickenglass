import { describe, it, expect } from "vitest";
import { computeSidenoteOffsets, type SidenoteMeasurement } from "./sidenote-render";

describe("computeSidenoteOffsets", () => {
  it("returns all zeros when sidenotes don't overlap", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 0, height: 40 },
      { top: 100, height: 40 },
      { top: 200, height: 40 },
    ];
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 0, 0]);
  });

  it("pushes the second sidenote down when two overlap", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 50 },
      { top: 120, height: 50 },
    ];
    // First bottom = 100+50 = 150, gap = 4 → second needs top >= 154
    // offset = 154 - 120 = 34
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34]);
  });

  it("cascades offsets through three overlapping sidenotes", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 50 },
      { top: 120, height: 50 },
      { top: 130, height: 50 },
    ];
    // Sidenote 0: offset=0, bottom=150
    // Sidenote 1: 120 < 154 → offset=34, bottom=120+34+50=204
    // Sidenote 2: 130 < 208 → offset=78, bottom=130+78+50=258
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34, 78]);
  });

  it("handles sidenotes at the exact same position", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 30 },
      { top: 100, height: 30 },
    ];
    // First bottom = 130, gap=4 → second needs 134
    // offset = 134 - 100 = 34
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34]);
  });

  it("returns empty array for empty input", () => {
    expect(computeSidenoteOffsets([])).toEqual([]);
  });

  it("returns [0] for a single sidenote", () => {
    expect(computeSidenoteOffsets([{ top: 50, height: 40 }])).toEqual([0]);
  });

  it("respects custom gap parameter", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 100, height: 50 },
      { top: 140, height: 50 },
    ];
    // gap=20 → second needs top >= 170 → offset = 170-140 = 30
    expect(computeSidenoteOffsets(measurements, 20)).toEqual([0, 30]);
  });

  it("only pushes sidenotes that actually overlap", () => {
    const measurements: SidenoteMeasurement[] = [
      { top: 0, height: 40 },
      { top: 10, height: 40 },   // overlaps with first
      { top: 200, height: 40 },  // no overlap
      { top: 210, height: 40 },  // overlaps with third
    ];
    // Sidenote 0: offset=0, bottom=40
    // Sidenote 1: 10 < 44 → offset=34, bottom=10+34+40=84
    // Sidenote 2: 200 >= 88 → offset=0, bottom=240
    // Sidenote 3: 210 < 244 → offset=34, bottom=210+34+40=284
    expect(computeSidenoteOffsets(measurements)).toEqual([0, 34, 0, 34]);
  });
});
