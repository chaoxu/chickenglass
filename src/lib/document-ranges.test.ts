import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  documentRangesFromChanges,
  expandChangedDocumentRange,
  expandChangedDocumentRangeToLines,
  mapDocumentRanges,
  mergeDocumentRanges,
  normalizeDirtyDocumentRange,
  positionInDocumentRanges,
  rangeIntersectsDocumentRanges,
  snapshotDocumentRanges,
} from "./document-ranges";

describe("mergeDocumentRanges", () => {
  it("sorts and merges overlapping or exactly touching ranges", () => {
    expect(mergeDocumentRanges([
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

  it("can merge ranges across a configured gap", () => {
    expect(mergeDocumentRanges([
      { from: 0, to: 2 },
      { from: 3, to: 4 },
      { from: 6, to: 8 },
    ], 1)).toEqual([
      { from: 0, to: 4 },
      { from: 6, to: 8 },
    ]);
  });
});

describe("normalizeDirtyDocumentRange", () => {
  it("clamps reversed ranges into document order", () => {
    expect(normalizeDirtyDocumentRange(12, 4, 10)).toEqual({ from: 4, to: 10 });
  });

  it("widens zero-length updates to a one-character window in non-empty docs", () => {
    expect(normalizeDirtyDocumentRange(5, 5, 10)).toEqual({ from: 5, to: 6 });
  });

  it("keeps empty-doc updates at {0, 0}", () => {
    expect(normalizeDirtyDocumentRange(0, 0, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("documentRangesFromChanges", () => {
  it("preserves zero-width post-change spans when using raw change expansion", () => {
    const state = EditorState.create({ doc: "abc" });
    const tr = state.update({ changes: { from: 1, to: 2, insert: "" } });

    expect(documentRangesFromChanges(tr.changes, expandChangedDocumentRange)).toEqual([
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
      documentRangesFromChanges(
        tr.changes,
        (from, to) => expandChangedDocumentRangeToLines(tr.state.doc, from, to),
      ),
    ).toEqual([
      { from: nextLine.from, to: nextLine.to },
    ]);
  });
});

describe("mapDocumentRanges", () => {
  it("maps ranges through document edits", () => {
    const state = EditorState.create({ doc: "hello world" });
    const tr = state.update({ changes: { from: 6, to: 11, insert: "friend" } });
    expect(mapDocumentRanges([{ from: 6, to: 11 }], tr.changes)).toEqual([{ from: 6, to: 12 }]);
  });
});

describe("document range queries", () => {
  it("checks whether positions are inside half-open ranges", () => {
    expect(positionInDocumentRanges(5, [{ from: 5, to: 10 }])).toBe(true);
    expect(positionInDocumentRanges(10, [{ from: 5, to: 10 }])).toBe(false);
  });

  it("matches ordinary overlapping ranges", () => {
    expect(rangeIntersectsDocumentRanges(5, 10, [{ from: 0, to: 6 }])).toBe(true);
    expect(rangeIntersectsDocumentRanges(10, 12, [{ from: 0, to: 6 }])).toBe(false);
  });

  it("treats zero-length candidates inside a range as intersecting", () => {
    expect(rangeIntersectsDocumentRanges(5, 5, [{ from: 0, to: 10 }])).toBe(true);
  });

  it("treats zero-length dirty ranges inside the candidate span as intersecting", () => {
    expect(rangeIntersectsDocumentRanges(5, 10, [{ from: 7, to: 7 }])).toBe(true);
  });
});

describe("snapshotDocumentRanges", () => {
  it("copies range objects and drops extra fields", () => {
    const ranges = [{ from: 1, to: 2, label: "visible" }];
    expect(snapshotDocumentRanges(ranges)).toEqual([
      { from: 1, to: 2 },
    ]);
  });
});
