import { describe, expect, it } from "vitest";
import type { TableRange } from "../state/table-discovery";
import type { HiddenWidgetStop, WidgetStopIndex } from "./widget-stop-index";
import {
  planVerticalMotionStop,
  shouldCorrectStructureExit,
  shouldFallbackRootMotion,
} from "./vertical-motion-planner";

function hiddenStop(from: number, to: number, startLine: number, endLine: number): HiddenWidgetStop {
  return {
    kind: "display-math",
    from,
    to,
    startLine,
    endLine,
  };
}

function tableRange(from: number, to: number, startLineNumber: number): TableRange {
  return {
    from,
    to,
    separatorFrom: from + 4,
    separatorTo: from + 8,
    parsed: {
      header: { cells: [{ content: "A" }] },
      alignments: ["none"],
      rows: [{ cells: [{ content: "B" }] }],
    },
    lines: ["| A |", "| - |", "| B |"],
    startLineNumber,
  };
}

function indexWithStops(
  hiddenStops: readonly HiddenWidgetStop[],
  tableStops: readonly { readonly table: TableRange; readonly startLine: number; readonly endLine: number }[],
): WidgetStopIndex {
  return {
    hiddenStopsForward: hiddenStops,
    hiddenStopsBackward: [...hiddenStops].reverse(),
    hiddenStopsBySpan: [...hiddenStops].sort((left, right) =>
      (left.to - left.from) - (right.to - right.from)
    ),
    tableStopsForward: tableStops,
    tableStopsBackward: [...tableStops].reverse(),
    tableStopsBySpan: [...tableStops].sort((left, right) =>
      (left.table.to - left.table.from) - (right.table.to - right.table.from)
    ),
  };
}

describe("vertical motion planner", () => {
  it("requests root-motion fallback when CM6 moves opposite the requested direction", () => {
    expect(shouldFallbackRootMotion(10, 9, true)).toBe(true);
    expect(shouldFallbackRootMotion(10, 11, false)).toBe(true);
    expect(shouldFallbackRootMotion(10, 11, true)).toBe(false);
  });

  it("corrects active-structure exits that reverse direction or jump too far", () => {
    expect(shouldCorrectStructureExit(10, 11, true, true)).toBe(false);
    expect(shouldCorrectStructureExit(10, 9, false, true)).toBe(true);
    expect(shouldCorrectStructureExit(10, 80, false, true)).toBe(true);
  });

  it("prioritizes crossed hidden stops before crossed tables and landed stops", () => {
    const hidden = hiddenStop(20, 40, 4, 5);
    const table = tableRange(50, 90, 6);
    const index = indexWithStops(
      [hidden],
      [{ table, startLine: 6, endLine: 8 }],
    );

    expect(planVerticalMotionStop(index, 2, 10, 60, true)).toEqual({
      kind: "hidden-crossed",
      stop: hidden,
    });
  });

  it("uses landed hidden stops before landed table stops after crossing checks miss", () => {
    const hidden = hiddenStop(20, 40, 4, 5);
    const table = tableRange(20, 90, 4);
    const index = indexWithStops(
      [hidden],
      [{ table, startLine: 4, endLine: 8 }],
    );

    expect(planVerticalMotionStop(index, 4, 5, 25, true)).toEqual({
      kind: "hidden-landed",
      stop: hidden,
    });
  });

  it("falls back to landed table stops when no hidden stop owns the head", () => {
    const table = tableRange(50, 90, 6);
    const index = indexWithStops(
      [],
      [{ table, startLine: 6, endLine: 8 }],
    );

    expect(planVerticalMotionStop(index, 6, 7, 60, true)).toEqual({
      kind: "table-landed",
      table,
    });
  });
});
