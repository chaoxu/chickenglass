import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  dirtyRangesFromChanges,
  expandChangeRange,
  expandChangeRangeToLines,
  mergeDirtyRanges,
  rangeIntersectsDirtyRanges,
} from "./incremental-dirty-ranges";

describe("mergeDirtyRanges", () => {
  it("sorts and merges overlapping or exactly touching ranges", () => {
    expect(mergeDirtyRanges([
      { from: 10, to: 12 },
      { from: 4, to: 6 },
      { from: 6, to: 9 },
      { from: 14, to: 16 },
    ])).toEqual([
      { from: 4, to: 9 },
      { from: 10, to: 12 },
      { from: 14, to: 16 },
    ]);
  });
});

describe("dirtyRangesFromChanges", () => {
  it("preserves zero-width post-change spans when using raw change expansion", () => {
    const state = EditorState.create({ doc: "abc" });
    const tr = state.update({ changes: { from: 1, to: 2, insert: "" } });

    expect(dirtyRangesFromChanges(tr.changes, expandChangeRange)).toEqual([
      { from: 1, to: 1 },
    ]);
  });

  it("expands changed ranges to full touched lines when requested", () => {
    const state = EditorState.create({ doc: "one\ntwo\nthree" });
    const line = state.doc.line(2);
    const tr = state.update({
      changes: { from: line.from + 1, to: line.from + 1, insert: "X" },
    });
    const nextLine = tr.state.doc.line(2);

    expect(
      dirtyRangesFromChanges(
        tr.changes,
        (from, to) => expandChangeRangeToLines(tr.state.doc, from, to),
      ),
    ).toEqual([
      { from: nextLine.from, to: nextLine.to },
    ]);
  });
});

describe("rangeIntersectsDirtyRanges", () => {
  it("matches ordinary overlapping ranges", () => {
    expect(rangeIntersectsDirtyRanges(5, 10, [{ from: 0, to: 6 }])).toBe(true);
    expect(rangeIntersectsDirtyRanges(10, 12, [{ from: 0, to: 6 }])).toBe(false);
  });

  it("treats zero-width dirty ranges inside the candidate span as intersecting", () => {
    expect(rangeIntersectsDirtyRanges(5, 10, [{ from: 7, to: 7 }])).toBe(true);
  });
});
